import {
  applyGeneratedContent,
  generationRequests,
  reviewRequest,
  type CourseTestResult,
  type FinalAssessmentResult,
  type GeneratedContent,
  type GenerationUsage,
  type ReviewResult,
  type TopicMaterialsResult,
} from './generated-materials';
import type { Generation, Material, Skeleton } from './schema';

type Requests = ReturnType<typeof generationRequests>;

// Шаги генерации на сервере. Браузер вызывает их по HTTP, единый эндпоинт агента — напрямую.
export interface ContentSteps {
  topic(input: Requests['topics'][number]): Promise<TopicMaterialsResult>;
  test(input: Requests['test']): Promise<CourseTestResult>;
  final(input: Requests['final']): Promise<FinalAssessmentResult>;
  review(input: ReturnType<typeof reviewRequest>): Promise<ReviewResult>;
}

export interface GenerationProgress {
  done: string[];
  content: GeneratedContent;
}

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
): Promise<{ materials: Material[]; generation: Generation }> {
  const requests = generationRequests(skeleton);
  const content: GeneratedContent = { topics: [], test: null, final: null };
  const generation: Generation = { calls: [], issues: [], failed: [], review: null };
  const done: string[] = [];
  const record = (step: string, label: string, usage: GenerationUsage) =>
    generation.calls.push({ step, label, ...usage });
  const attempt = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
      done.push(label);
    } catch (error) {
      generation.failed.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
    onProgress({ done: [...done], content });
  };
  await inPool([
    // Тест и итоговая аттестация не зависят от тем, поэтому идут первыми и не ждут хвост очереди.
    () =>
      attempt('Итоговый тест', async () => {
        const result = await steps.test(requests.test);
        content.test = result;
        generation.issues.push(...result.issues);
        record('course_test', 'Итоговый тест', result.usage);
      }),
    () =>
      attempt('Итоговая аттестация', async () => {
        const result = await steps.final(requests.final);
        content.final = result;
        generation.issues.push(...result.issues);
        record('final_assessment', 'Итоговая аттестация', result.usage);
      }),
    ...requests.topics.map(
      (input) => () =>
        attempt(`Тема ${input.topic.number}`, async () => {
          const result = await steps.topic(input);
          content.topics.push(result);
          record('topic_materials', `Тема ${input.topic.number}`, result.usage);
        }),
    ),
  ]);
  const generated = applyGeneratedContent(skeleton, materials, content);
  await attempt('Самопроверка', async () => {
    const result = await steps.review(reviewRequest(skeleton, generated));
    generation.review = { summary: result.summary, issues: result.issues };
    record('review_course', 'Самопроверка', result.usage);
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
