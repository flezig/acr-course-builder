import {
  courseTestResultSchema,
  finalAssessmentResultSchema,
  programSectionsResultSchema,
  repairTestResultSchema,
  reviewResultSchema,
  topicMaterialsResultSchema,
  applyGeneratedContent,
  generationRequests,
  reviewRequest,
  type CourseTestResult,
  type FinalAssessmentResult,
  type GeneratedContent,
  type GenerationUsage,
  type ProgramSectionsResult,
  type RepairTestResult,
  type ReviewResult,
  type TopicMaterialsResult,
} from './generated-materials';
import { z } from 'zod';
import { canonicalJson } from '../../../shared/lib/decimal';
import type { Generation, Material, Skeleton } from './schema';

type Requests = ReturnType<typeof generationRequests>;

// Шаги генерации на сервере. Браузер вызывает их по HTTP, единый эндпоинт агента — напрямую.
export interface ContentSteps {
  topic(input: Requests['topics'][number]): Promise<TopicMaterialsResult>;
  test(input: Requests['test']): Promise<CourseTestResult>;
  final(input: Requests['final']): Promise<FinalAssessmentResult>;
  review(input: ReturnType<typeof reviewRequest>): Promise<ReviewResult>;
  repairTest(input: RepairRequest): Promise<RepairTestResult>;
  sections(input: Requests['sections']): Promise<ProgramSectionsResult>;
}

export interface RepairRequest {
  brief: Requests['test']['brief'];
  replace: Array<{
    number: number;
    text: string;
    options: string[];
    correct: string;
    outcome: string;
    problem: string;
  }>;
  add: string[];
}

// Что исправить в тесте после самопроверки: вопросы с ошибкой и результаты без вопросов.
export function repairRequest(
  brief: Requests['test']['brief'],
  test: CourseTestResult,
  review: ReviewResult,
  questionCount: number,
): RepairRequest {
  const replace = review.issues.flatMap((issue) => {
    const number = Number(issue.element.match(/Вопрос\s+(\d+)/i)?.[1]);
    const question = test.questions[number - 1];
    if (issue.severity !== 'error' || !question) return [];
    return [
      {
        number,
        text: question.text,
        options: question.options,
        correct: question.options[question.correct_index],
        outcome: question.outcome_code,
        problem: `${issue.message} ${issue.fix}`.trim(),
      },
    ];
  });
  // Сначала результаты без вопросов, затем добор до нужного числа вопросов по результатам,
  // у которых вопросов меньше всего: код отбрасывает вопросы с неверным ключом.
  const counts = new Map(brief.outcomes.map((o) => [o.code, 0]));
  for (const q of test.questions) counts.set(q.outcome_code, (counts.get(q.outcome_code) ?? 0) + 1);
  const add: string[] = [];
  while (test.questions.length + add.length < questionCount || [...counts.values()].includes(0)) {
    const [code] = [...counts.entries()].sort((a, b) => a[1] - b[1])[0];
    add.push(code);
    counts.set(code, counts.get(code)! + 1);
  }
  return {
    brief,
    replace: replace.filter((q, i) => replace.findIndex((r) => r.number === q.number) === i),
    add,
  };
}

export interface GenerationProgress {
  done: string[];
  content: GeneratedContent;
  checkpoint?: ContentCheckpoint;
}

export const contentCheckpointSchema = z.record(
  z.string(),
  z.object({ input: z.string(), result: z.unknown() }),
);
export type ContentCheckpoint = z.infer<typeof contentCheckpointSchema>;

// Шлюз пропускает два одновременных запроса команды; третий получит 429.
const concurrency = 2;

async function inPool<T>(tasks: Array<() => Promise<T>>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length) await tasks[next++]();
    }),
  );
}

// Ошибка одного шага не останавливает остальные: материал остаётся заготовкой,
// а причина попадает в generation.failed и видна методисту.
export async function generateContent(
  skeleton: Skeleton,
  materials: Material[],
  steps: ContentSteps,
  onProgress: (progress: GenerationProgress) => void = () => {},
  checkpoint: ContentCheckpoint = {},
): Promise<{ materials: Material[]; generation: Generation }> {
  const requests = generationRequests(skeleton);
  const content: GeneratedContent = { topics: [], test: null, final: null };
  const generation: Generation = { calls: [], issues: [], failed: [], review: null };
  const done: string[] = [];
  async function completedStep<T extends { usage: GenerationUsage }>(
    key: string,
    input: unknown,
    schema: z.ZodType<T>,
    generate: () => Promise<T>,
  ): Promise<T> {
    const signature = canonicalJson(input);
    const saved = checkpoint[key];
    if (saved?.input === signature) {
      const parsed = schema.safeParse(saved.result);
      if (parsed.success)
        return {
          ...parsed.data,
          usage: { ...parsed.data.usage, cached: true, cost_rub: 0, duration_ms: 0 },
        };
    }
    const result = schema.parse(await generate());
    // Сохраняем исходный ответ, чтобы доработка теста не меняла результат предыдущего шага.
    checkpoint[key] = { input: signature, result: structuredClone(result) };
    return result;
  }
  const record = (step: string, label: string, usage: GenerationUsage) =>
    generation.calls.push({ step, label, ...usage });
  const attempt = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
      done.push(label);
    } catch (error) {
      generation.failed.push(
        `${label}: ${error instanceof Error ? error.message : String(error)} Готовые части сохранены; повторите незавершённые шаги.`,
      );
    }
    onProgress({ done: [...done], content, checkpoint });
  };
  await inPool([
    // Тест и итоговая аттестация не зависят от тем, поэтому идут первыми и не ждут хвост очереди.
    () =>
      attempt('Итоговый тест', async () => {
        const result = await completedStep('test', requests.test, courseTestResultSchema, () =>
          steps.test(requests.test),
        );
        content.test = result;
        generation.issues.push(...result.issues);
        record('course_test', 'Итоговый тест', result.usage);
      }),
    () =>
      attempt('Итоговая аттестация', async () => {
        const result = await completedStep(
          'final',
          requests.final,
          finalAssessmentResultSchema,
          () => steps.final(requests.final),
        );
        content.final = result;
        generation.issues.push(...result.issues);
        record('final_assessment', 'Итоговая аттестация', result.usage);
      }),
    () =>
      attempt('Разделы программы', async () => {
        const result = await completedStep(
          'sections',
          requests.sections,
          programSectionsResultSchema,
          () => steps.sections(requests.sections),
        );
        generation.program_sections = result.sections;
        record('program_sections', 'Разделы программы', result.usage);
      }),
    ...requests.topics.map(
      (input) => () =>
        attempt(`Тема ${input.topic.number}`, async () => {
          const result = await completedStep(
            `topic:${input.topic.id}`,
            input,
            topicMaterialsResultSchema,
            () => steps.topic(input),
          );
          content.topics.push(result);
          record('topic_materials', `Тема ${input.topic.number}`, result.usage);
        }),
    ),
  ]);
  let generated = applyGeneratedContent(skeleton, materials, content);
  let review: ReviewResult | null = null;
  await attempt('Самопроверка', async () => {
    const input = reviewRequest(skeleton, generated);
    review = await completedStep('review', input, reviewResultSchema, () => steps.review(input));
    generation.review = { summary: review.summary, issues: review.issues };
    record('review_course', 'Самопроверка', review.usage);
  });
  // Цикл агента замыкается: ошибки ключей и непокрытые результаты исправляет отдельный шаг,
  // а замечание помечается исправленным. Повторной самопроверки нет, чтобы не платить дважды.
  const test = content.test;
  const repair =
    test && review
      ? repairRequest(requests.test.brief, test, review, requests.test.question_count)
      : null;
  if (test && repair && (repair.replace.length || repair.add.length))
    await attempt('Доработка теста', async () => {
      const result = await completedStep('repair', repair, repairTestResultSchema, () =>
        steps.repairTest(repair),
      );
      record('test_repair', 'Доработка теста', result.usage);
      const fixed = result.questions.slice(0, repair.replace.length);
      fixed.forEach((question, i) => {
        test.questions[repair.replace[i].number - 1] = question;
      });
      test.questions.push(...result.questions.slice(repair.replace.length));
      for (const issue of generation.review?.issues ?? []) {
        const number = Number(issue.element.match(/Вопрос\s+(\d+)/i)?.[1]);
        if (repair.replace.slice(0, fixed.length).some((q) => q.number === number))
          issue.resolved = true;
      }
      const added = result.questions.length - fixed.length;
      if (added) generation.issues.push(`Добавлено вопросов по непокрытым результатам: ${added}.`);
      generated = applyGeneratedContent(skeleton, materials, content);
    });
  return { materials: generated, generation };
}

export function generationCost(generation: Generation) {
  return generation.calls.reduce(
    (total, call) => ({
      tokens: total.tokens + call.prompt_tokens + call.completion_tokens,
      cost_rub: total.cost_rub + call.cost_rub,
    }),
    { tokens: 0, cost_rub: 0 },
  );
}
