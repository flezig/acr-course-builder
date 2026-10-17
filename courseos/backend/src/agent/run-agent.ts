import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { CallUsage, LlmGateway } from '../llm/gateway.ts';
import { clarifyQuestions, type ClarifyingQuestion } from '../steps/clarify-questions.ts';
import { draftSkeleton } from '../steps/draft-skeleton.ts';
import {
  finalInputSchema,
  generateCourseTest,
  generateFinalAssessment,
  generateProgramSections,
  generateTopicMaterials,
  repairInputSchema,
  repairTest,
  sectionsInputSchema,
  testInputSchema,
  topicInputSchema,
} from '../steps/generate-materials.ts';
import { parseRequest, type ParsedRequest } from '../steps/parse-request.ts';
import { reviewCourse, reviewInputSchema } from '../steps/review-course.ts';

// Единый эндпоинт агента: разбор → уточнения → каркас; после утверждения
// методистом — материалы → самопроверка → выгрузки.
// Сборку курса, часы и проверки выполняет тот же движок, что и интерфейс
// (frontend/src/agent/headless.ts, собирается командой npm run build:agent).

export const agentRequestSchema = z.object({
  request: z.string().trim().min(1).max(8000),
  // Ответы на уточняющие вопросы прошлого вызова свободным текстом: добавляются к запросу.
  clarifications: z.string().trim().max(4000).default(''),
  // Ответы на содержательные вопросы модели: ключ — id или текст вопроса.
  answers: z.record(z.string(), z.string()).default({}),
  // true — явный автоматический прогон без утверждения человеком.
  approve: z.boolean().default(false),
  references: z
    .array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          text: z.string().max(12000),
          url: z.string().default(''),
          scope: z.string().default(''),
          coordinate: z.string().default(''),
        })
        .passthrough(),
    )
    .max(20)
    .default([]),
  // false — сразу вернуть run_id, ход сборки смотреть в GET /api/v1/agent/runs/{id}.
  wait: z.boolean().default(true),
});

export const skeletonReviewSchema = z.object({
  skeleton_version: z.number().int().positive(),
  skeleton_hash: z.string().min(1),
  course_version: z.number().int().positive(),
});
export const findingReviewSchema = skeletonReviewSchema.extend({
  decision: z.discriminatedUnion('action', [
    z.object({
      action: z.literal('save_skeleton'),
      issue_id: z.literal('skeleton').default('skeleton'),
      skeleton: z.unknown(),
    }),
    z.object({
      action: z.literal('recheck_materials'),
      issue_id: z.literal('quality').default('quality'),
    }),
    z.object({ action: z.literal('apply_finding'), issue_id: z.string().min(1) }),
    z.object({
      action: z.literal('dismiss_finding'),
      issue_id: z.string().min(1),
      reason: z.string().trim().min(3).max(4000),
    }),
  ]),
});
export class AgentReviewError extends Error {
  readonly status = 422;
}

type SkeletonReview = z.infer<typeof skeletonReviewSchema>;
type FindingReview = z.infer<typeof findingReviewSchema>;

export type AgentRequest = z.infer<typeof agentRequestSchema>;

type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_clarification'
  | 'awaiting_approval'
  | 'blocked'
  | 'succeeded'
  | 'needs_review'
  | 'failed';

interface RunEvent {
  at: string;
  elapsed_ms: number;
  step: string;
  detail: string;
}

interface Run {
  run_id: string;
  status: RunStatus;
  created_at: string;
  request: AgentRequest;
  events: RunEvent[];
  calls: Array<CallUsage & { label: string }>;
  result: Record<string, unknown>;
  error: string | null;
  phase?: 'design' | 'approval' | 'content' | 'export';
  checkpoint?: { course_id: string; state: unknown };
}

const fileNames = {
  docx: 'program.docx',
  pptx: 'slides.pptx',
  lms: 'test-moodle.xml',
  json: 'course.json',
  markdown: 'rationale.md',
} as const;

const contentTypes: Record<string, string> = {
  'program.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'slides.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'test-moodle.xml': 'application/xml; charset=utf-8',
  'course.json': 'application/json; charset=utf-8',
  'rationale.md': 'text/markdown; charset=utf-8',
};

// Без типа программы и объёма каркас не построить — их агент спрашивает всегда. Остальные
// поля сводки спрашиваются, если их не хватает двух и больше (запрос явно неполный);
// одно недостающее поле агент помечает допущением и продолжает, сообщая об этом.
const secondaryFields = {
  audience: ['Кто слушатели программы?', 'Слушатели не указаны в запросе; уточняет методист'],
  entry_level: [
    'Какой входной уровень подготовки у слушателей?',
    'Входной уровень не указан в запросе; уточняет методист',
  ],
  delivery: [
    'В какой форме проходит обучение: очно, заочно, дистанционно?',
    'Форма обучения не указана в запросе; уточняет методист',
  ],
  assessment: [
    'Какая форма итоговой аттестации предусмотрена?',
    'Защита итоговой работы (форма не указана в запросе; уточняет методист)',
  ],
} as const;

export function summaryGaps(parameters: ParsedRequest): {
  questions: string[];
  assumed: Partial<Record<keyof typeof secondaryFields, string>>;
} {
  const hours = Number(parameters.total_hours);
  const required = [
    parameters.template_id === 'unknown' &&
      'Какой тип программы нужен: повышение квалификации или общеразвивающая?',
    !(hours >= 16 && hours <= 500) && 'Какой объём программы в академических часах (16–500)?',
  ].filter((question): question is string => Boolean(question));
  const secondary = (Object.keys(secondaryFields) as Array<keyof typeof secondaryFields>).filter(
    (field) => !parameters[field].trim(),
  );
  if (required.length || secondary.length >= 2)
    return {
      questions: [...required, ...secondary.map((field) => secondaryFields[field][0])],
      assumed: {},
    };
  return {
    questions: [],
    assumed: Object.fromEntries(secondary.map((field) => [field, secondaryFields[field][1]])),
  };
}

// Интерфейс бандла движка; типы самого движка живут во фронтенде.
interface EngineSnapshot extends Omit<SnapshotLike, 'audit'> {
  materials: Array<{
    id: string;
    type: string;
    title: string;
    topic_id: string;
    questions: unknown[];
    slides: unknown[];
  }>;
  generation?: unknown;
  audit: {
    technical_ready: boolean;
    checks: Array<{ title: string; status: string; actual: string }>;
    issues: Array<{
      id: string;
      message: string;
      blocking: boolean;
      severity: string;
      check_type: string;
      fix?: string;
      dismissible?: boolean;
      suggested_fix: string;
    }>;
  };
}
interface Headless {
  makeRequirements(input: {
    request: string;
    parameters: ParsedRequest;
    design: unknown;
    questions: ClarifyingQuestion[];
    answers: Record<string, string>;
    actor: string;
    references?: AgentRequest['references'];
  }): { requirements: unknown; assumptions: string[] };
  buildSkeleton(
    requirements: unknown,
    steps: unknown,
  ): Promise<{
    api: unknown;
    courseId: string;
    snapshot: EngineSnapshot | null;
    job: { status: string; next_action: string };
  }>;
  reviewFinding(
    api: unknown,
    courseId: string,
    review: SkeletonReview,
    decision: FindingReview['decision'],
  ): Promise<EngineSnapshot>;
  approveAndGenerate(
    api: unknown,
    courseId: string,
    actor: string,
    onEvent: (event: { step: string; detail: string }) => void,
    review?: SkeletonReview,
    onCheckpoint?: (state: unknown) => Promise<void>,
  ): Promise<{
    decisions: unknown[];
    blocking: Array<{ message: string }>;
    snapshot: EngineSnapshot;
    files: Record<keyof typeof fileNames, string | Uint8Array | null> | null;
    job: { status: string };
  }>;
  exportReviewed(
    api: unknown,
    courseId: string,
  ): Promise<Record<keyof typeof fileNames, string | Uint8Array | null>>;
  exportCourseState(api: unknown, courseId: string): Promise<unknown>;
  restoreCourseState(courseId: string, state: unknown, steps: unknown): Promise<unknown>;
  resumeGeneration(
    api: unknown,
    courseId: string,
    onEvent: (event: { step: string; detail: string }) => void,
    onCheckpoint: (state: unknown) => Promise<void>,
  ): ReturnType<Headless['approveAndGenerate']>;
  checklist(snapshot: EngineSnapshot): unknown;
}

export class AgentRunner {
  private readonly gateway: LlmGateway;
  private readonly dataDir: string;
  private readonly bundlePath: string;
  private readonly runs = new Map<string, Run>();
  // Активные движки восстанавливаются из checkpoint сохранённого запуска.
  private readonly pending = new Map<string, { api: unknown; courseId: string }>();
  // Сборки идут по одной: шлюз всё равно пропускает два запроса, а движок курса
  // держит одно хранилище в памяти.
  private queue: Promise<unknown> = Promise.resolve();
  private headless?: Promise<Headless>;
  private readonly saves = new Map<string, Promise<void>>();

  constructor(gateway: LlmGateway, dataDir: string, bundlePath: string) {
    this.gateway = gateway;
    this.dataDir = dataDir;
    this.bundlePath = bundlePath;
  }

  private engine() {
    this.headless ??= (
      import(pathToFileURL(resolve(this.bundlePath)).href) as Promise<Headless>
    ).catch((error) => {
      this.headless = undefined;
      throw error;
    });
    return this.headless;
  }

  private runDir(id: string) {
    return join(this.dataDir, 'runs', id);
  }

  private contentSteps(run: Run) {
    const gateway = this.gateway;
    const track = <T extends { usage: CallUsage }>(label: string, result: T) => {
      run.calls.push({ ...result.usage, label });
      this.event(run, 'content', `${label}: ${describe(result.usage)}`);
      return result;
    };
    return {
      topic: async (input: unknown) => {
        const parsed = topicInputSchema.parse(input);
        return track(`Тема ${parsed.topic.number}`, await generateTopicMaterials(gateway, parsed));
      },
      test: async (input: unknown) =>
        track('Итоговый тест', await generateCourseTest(gateway, testInputSchema.parse(input))),
      final: async (input: unknown) =>
        track(
          'Итоговая аттестация',
          await generateFinalAssessment(gateway, finalInputSchema.parse(input)),
        ),
      sections: async (input: unknown) =>
        track(
          'Разделы программы',
          await generateProgramSections(gateway, sectionsInputSchema.parse(input)),
        ),
      repairTest: async (input: unknown) =>
        track('Доработка теста', await repairTest(gateway, repairInputSchema.parse(input))),
      review: async (input: unknown) =>
        track('Самопроверка', await reviewCourse(gateway, reviewInputSchema.parse(input))),
    };
  }

  private event(run: Run, step: string, detail: string) {
    run.events.push({
      at: new Date().toISOString(),
      elapsed_ms: Date.now() - Date.parse(run.created_at),
      step,
      detail,
    });
  }

  async start(request: AgentRequest) {
    const run: Run = {
      run_id: randomUUID(),
      status: 'queued',
      created_at: new Date().toISOString(),
      request,
      events: [],
      calls: [],
      result: {},
      error: null,
    };
    this.runs.set(run.run_id, run);
    run.phase = 'design';
    try {
      await this.save(run);
    } catch (error) {
      this.fail(run, error);
      return run;
    }
    const done = this.enqueue(run, () => this.execute(run));
    if (request.wait) await done;
    return run;
  }

  private async pendingReview(id: string, review: SkeletonReview, includeMaterials = false) {
    const run = await this.get(id);
    if (
      !run ||
      !(
        run.status === 'awaiting_approval' ||
        (includeMaterials && ['needs_review', 'succeeded'].includes(run.status))
      ) ||
      !run.checkpoint
    )
      return null;
    const skeleton = run.result.skeleton as ReturnType<typeof skeletonView>;
    if (
      skeleton.version !== review.skeleton_version ||
      skeleton.hash !== review.skeleton_hash ||
      skeleton.course_version !== review.course_version
    )
      return null;
    run.status = 'queued';
    return { run };
  }

  async review(id: string, input: FindingReview) {
    const current = await this.pendingReview(id, input, true);
    if (!current) return null;
    const { run } = current;
    const materialReview = !!run.result.generation;
    const done = this.enqueue(run, async () => {
      const pending = await this.restore(run);
      try {
        const engine = await this.engine();
        const before = run.result.skeleton as ReturnType<typeof skeletonView>;
        const issue = before.audit_issues.find((i) => i.id === input.decision.issue_id);
        const snapshot = await engine.reviewFinding(
          pending.api,
          pending.courseId,
          input,
          input.decision,
        );
        run.result.skeleton = skeletonView(
          snapshot,
          (run.result.skeleton as ReturnType<typeof skeletonView>).model_issues,
        );
        run.checkpoint = {
          course_id: pending.courseId,
          state: await engine.exportCourseState(pending.api, pending.courseId),
        };
        run.result.blocking = snapshot.audit.issues.filter((i) => i.blocking).map((i) => i.message);
        run.result.next_action =
          'Проверьте обновлённый каркас; разберите оставшиеся блокировки через /review и вызовите /approve с актуальными версиями.';
        run.result.decisions = [
          ...((run.result.decisions as unknown[]) ?? []),
          {
            issue_id: input.decision.issue_id,
            issue: issue?.message,
            action:
              input.decision.action === 'save_skeleton'
                ? 'edited_skeleton'
                : input.decision.action === 'recheck_materials'
                  ? 'rechecked'
                  : input.decision.action === 'apply_finding'
                    ? 'applied'
                    : 'accepted_as_is',
            reason:
              input.decision.action === 'dismiss_finding'
                ? input.decision.reason
                : issue?.suggested_fix,
            actor: 'methodist-api',
          },
        ];
        if (input.decision.action === 'save_skeleton')
          run.result.approval = { mode: 'human', human_approved: false };
        if (materialReview) {
          const files = await engine.exportReviewed(pending.api, pending.courseId);
          for (const [format, name] of Object.entries(fileNames)) {
            const content = files[format as keyof typeof fileNames];
            if (content !== null) await atomicWrite(join(this.runDir(id), name), content);
          }
          run.result.generation = snapshot.generation;
          run.result.audit = snapshot.audit;
          run.result.checklist = engine.checklist(snapshot);
          run.result.next_action = snapshot.audit.technical_ready
            ? 'Комплект проверен с учётом решений методиста.'
            : 'Разберите оставшиеся замечания комплекта.';
        }
        this.event(
          run,
          'review',
          `Решение методиста: ${input.decision.action}, ${input.decision.issue_id}`,
        );
      } catch (error) {
        throw new AgentReviewError(error instanceof Error ? error.message : String(error));
      } finally {
        run.status =
          materialReview && input.decision.action !== 'save_skeleton'
            ? (run.result.audit as EngineSnapshot['audit'])?.technical_ready
              ? 'succeeded'
              : 'needs_review'
            : 'awaiting_approval';
        await this.save(run);
      }
      return run;
    });
    await done;
    return run;
  }

  async approve(id: string, review: SkeletonReview) {
    const current = await this.pendingReview(id, review);
    if (!current) return null;
    const { run } = current;
    const done = this.enqueue(run, () => this.generate(run, 'methodist-api', review));
    if (run.request.wait) await done;
    return run;
  }

  async get(id: string): Promise<Run | null> {
    const inMemory = this.runs.get(id);
    if (inMemory) return inMemory;
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    let text: string;
    try {
      text = await readFile(join(this.runDir(id), 'run.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AgentStorageError();
    }
    let run: Run;
    try {
      run = JSON.parse(text) as Run;
      if (
        run.run_id !== id ||
        !Array.isArray(run.events) ||
        !Array.isArray(run.calls) ||
        !run.result ||
        !agentRequestSchema.safeParse(run.request).success
      )
        throw new Error('invalid');
    } catch {
      throw new AgentReviewError(
        'Сохранённая сборка повреждена. Сохраните её данные и обратитесь к администратору.',
      );
    }
    const loaded = this.runs.get(id);
    if (loaded) return loaded;
    this.runs.set(id, run);
    if (['queued', 'running'].includes(run.status))
      this.fail(
        run,
        new Error(
          'Сервер был перезапущен во время сборки. Готовые части сохранены; повторите незавершённые шаги.',
        ),
        'interrupted',
      );
    return run;
  }

  async file(id: string, name: string) {
    if (!(name in contentTypes) || !/^[0-9a-f-]{36}$/.test(id)) return null;
    const body = await readFile(join(this.runDir(id), name)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AgentStorageError();
    });
    return body ? { body, contentType: contentTypes[name] } : null;
  }

  view(run: Run) {
    const cost = run.calls.reduce((sum, call) => sum + call.cost_rub, 0);
    const tokens = run.calls.reduce((sum, c) => sum + c.prompt_tokens + c.completion_tokens, 0);
    return {
      run_id: run.run_id,
      status: run.status,
      created_at: run.created_at,
      elapsed_ms: run.events.at(-1)?.elapsed_ms ?? 0,
      error: run.error,
      usage: {
        calls: run.calls.length,
        tokens,
        cost_rub: Number(cost.toFixed(2)),
        by_call: run.calls.map(
          ({ label, model, prompt_tokens, completion_tokens, cost_rub, duration_ms, cached }) => ({
            label,
            model,
            prompt_tokens,
            completion_tokens,
            cost_rub: Number(cost_rub.toFixed(4)),
            duration_ms,
            cached,
          }),
        ),
      },
      events: run.events,
      ...run.result,
    };
  }

  private save(run: Run): Promise<void> {
    const previous = this.saves.get(run.run_id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        await mkdir(this.runDir(run.run_id), { recursive: true });
        await atomicWrite(join(this.runDir(run.run_id), 'run.json'), JSON.stringify(run, null, 1));
      })
      .catch(() => {
        throw new AgentStorageError();
      });
    this.saves.set(run.run_id, next);
    return next;
  }

  private enqueue(run: Run, work: () => Promise<unknown>): Promise<void> {
    const done = this.queue.then(async () => {
      try {
        await work();
        await this.save(run);
      } catch (error) {
        if (error instanceof AgentReviewError) throw error;
        this.fail(run, error);
        try {
          await this.save(run);
        } catch {
          this.fail(run, new AgentStorageError());
          console.error(`Не удалось сохранить сборку ${run.run_id}`);
        }
      }
    });
    // Отказ одной операции возвращается её клиенту, но не отравляет очередь остальных.
    this.queue = done.then(
      () => {},
      () => {},
    );
    return done;
  }

  private fail(run: Run, error: unknown, code?: string) {
    run.status = 'failed';
    run.error = error instanceof Error ? error.message : String(error);
    const failure = describeFailure(error, code);
    run.result.failure = { ...failure, message: run.error };
    run.result.next_action = failure.action;
    this.event(run, 'error', run.error);
  }

  private async restore(run: Run) {
    let pending = this.pending.get(run.run_id);
    if (!pending) {
      if (!run.checkpoint)
        throw new Error('Нет сохранённого каркаса. Повторите построение программы.');
      const engine = await this.engine();
      pending = {
        api: await engine.restoreCourseState(
          run.checkpoint.course_id,
          run.checkpoint.state,
          this.contentSteps(run),
        ),
        courseId: run.checkpoint.course_id,
      };
      this.pending.set(run.run_id, pending);
    }
    return pending;
  }

  async retry(id: string) {
    const run = await this.get(id);
    const generation = run?.result.generation as { failed?: unknown[] } | undefined;
    if (
      !run ||
      !(run.status === 'failed' || (run.status === 'needs_review' && generation?.failed?.length))
    )
      return null;
    if ((run.result.failure as { retryable?: boolean } | undefined)?.retryable === false)
      return null;
    const resume = run.phase !== 'design' && Boolean(run.checkpoint);
    run.status = 'queued';
    run.error = null;
    delete run.result.failure;
    this.event(run, 'retry', 'Повтор незавершённых шагов; готовые части сохранены.');
    const done = this.enqueue(run, async () => {
      await this.save(run);
      if (run.phase === 'approval' && run.checkpoint) {
        await this.restore(run);
        run.status = 'awaiting_approval';
        run.result.next_action = 'Проверьте сохранённый каркас и утвердите его через /approve.';
      } else if (resume) await this.generate(run, 'resume', undefined, true);
      else await this.execute(run);
    });
    if (run.request.wait) await done;
    return run;
  }

  private async execute(run: Run) {
    run.status = 'running';
    try {
      await this.design(run);
      if (run.status === 'running' && run.request.approve)
        await this.generate(run, 'automatic-api');
    } catch (error) {
      this.fail(run, error);
    }
    await this.save(run);
  }

  // Шаги до утверждения: сводка, уточнения и каркас программы.
  private async design(run: Run) {
    const { request, clarifications, answers } = run.request;
    const fullRequest = clarifications
      ? `${request}\n\nОтветы методиста на уточняющие вопросы:\n${clarifications}`
      : request;
    const analysis = await parseRequest(this.gateway, fullRequest);
    run.calls.push({ ...analysis.usage, label: 'Разбор запроса' });
    const parameters = analysis.parameters;
    this.event(run, 'parse_request', `Сводка параметров: ${describe(analysis.usage)}`);
    run.result.parameters = parameters;
    run.result.corrections = analysis.corrections;
    const gaps = summaryGaps(parameters);
    if (gaps.questions.length) {
      // Неполный запрос: агент не достраивает параметры сам, а спрашивает методиста.
      run.status = 'awaiting_clarification';
      run.result.questions = gaps.questions;
      run.result.next_action =
        'Повторите POST /api/v1/agent с тем же request и ответами в поле clarifications.';
      this.event(run, 'clarification', `Нужны ответы методиста: ${gaps.questions.length}`);
      return;
    }
    const assumptions = Object.values(gaps.assumed);
    Object.assign(parameters, gaps.assumed);
    const summary = {
      request: fullRequest,
      title: parameters.title,
      template_id: parameters.template_id,
      audience: parameters.audience,
      entry_level: parameters.entry_level,
      goal: parameters.goal,
      total_hours: parameters.total_hours,
      delivery: parameters.delivery,
      assessment: parameters.assessment,
      constraints: parameters.constraints,
    };
    const { questions, usage } = await clarifyQuestions(this.gateway, summary);
    run.calls.push({ ...usage, label: 'Уточняющие вопросы' });
    this.event(run, 'clarify_questions', `Вопросов по содержанию: ${questions.length}`);
    // Без ответа методиста берётся рекомендованный моделью вариант; это помечено в ответе.
    const answered = questions.map((question: ClarifyingQuestion) => {
      const given = answers[question.id] ?? answers[question.label];
      return {
        ...question,
        answer: given?.trim() || question.recommended,
        answered_by: given?.trim() ? 'methodist' : 'agent_recommendation',
      };
    });
    run.result.content_questions = answered;
    const draft = await draftSkeleton(this.gateway, {
      ...summary,
      references: run.request.references,
      total_hours: Number(parameters.total_hours),
      answers: answered.map((q) => ({ question: q.label, answer: q.answer })),
    });
    run.calls.push({ ...draft.design.generated_by, label: 'Каркас программы' });
    this.event(run, 'draft_skeleton', `Структура каркаса: ${describe(draft.design.generated_by)}`);
    const engine = await this.engine();
    const { requirements, assumptions: calendarAssumptions } = engine.makeRequirements({
      request: fullRequest,
      parameters,
      design: { ...draft.design, issues: draft.issues },
      questions,
      answers: Object.fromEntries(answered.map((q) => [q.id, q.answer])),
      actor: 'api-client',
      references: run.request.references,
    });
    run.result.assumptions = [
      ...assumptions,
      ...calendarAssumptions,
      ...answered
        .filter((q) => q.answered_by === 'agent_recommendation')
        .map((q) => `${q.label} — выбран рекомендованный вариант «${q.answer}».`),
    ];
    const built = await engine.buildSkeleton(requirements, this.contentSteps(run));
    if (!built.snapshot) throw new Error(`Каркас не построен: ${built.job.next_action}`);
    this.pending.set(run.run_id, { api: built.api, courseId: built.courseId });
    run.checkpoint = {
      course_id: built.courseId,
      state: await engine.exportCourseState(built.api, built.courseId),
    };
    run.phase = 'approval';
    run.result.skeleton = skeletonView(built.snapshot, draft.issues);
    this.event(
      run,
      'skeleton',
      `Каркас готов: ${built.snapshot.skeleton.topics.length} строк учебного плана, ${built.snapshot.skeleton.outcomes.length} результатов`,
    );
    run.result.approval = {
      mode: run.request.approve ? 'automatic' : 'human',
      human_approved: false,
    };
    run.result.skeleton_ms = Date.now() - Date.parse(run.created_at);
    if (!run.request.approve) {
      run.status = 'awaiting_approval';
      run.result.next_action = `Проверьте каркас и вызовите POST /api/v1/agent/runs/${run.run_id}/approve.`;
    }
  }

  private async generate(run: Run, actor: string, review?: SkeletonReview, resume = false) {
    run.status = 'running';
    const pending = await this.restore(run);
    const engine = await this.engine();
    run.phase = 'content';
    const checkpoint = async (state: unknown) => {
      run.checkpoint = { course_id: pending.courseId, state };
      await this.save(run);
    };
    const onEvent = (event: { step: string; detail: string }) => {
      if (event.step === 'approval' || event.step === 'automatic_approval')
        run.result.approval = {
          mode: actor === 'automatic-api' ? 'automatic' : 'human',
          human_approved: actor !== 'automatic-api',
          actor,
        };
      this.event(run, event.step, event.detail);
    };
    try {
      const result = resume
        ? await engine.resumeGeneration(pending.api, pending.courseId, onEvent, checkpoint)
        : await engine.approveAndGenerate(
            pending.api,
            pending.courseId,
            actor,
            onEvent,
            review,
            checkpoint,
          );
      run.result.decisions = [...((run.result.decisions as unknown[]) ?? []), ...result.decisions];
      run.checkpoint = {
        course_id: pending.courseId,
        state: await engine.exportCourseState(pending.api, pending.courseId),
      };
      run.result.skeleton = skeletonView(
        result.snapshot,
        (run.result.skeleton as ReturnType<typeof skeletonView>).model_issues,
      );
      if (!result.files) {
        run.status = actor === 'automatic-api' ? 'blocked' : 'awaiting_approval';
        run.result.blocking = result.blocking.map((issue) => issue.message);
        run.result.next_action =
          'Разберите блокирующие замечания через /review, затем проверьте каркас и вызовите /approve.';
        await this.save(run);
        return;
      }
      if (!resume)
        run.result.approval = {
          mode: actor === 'automatic-api' ? 'automatic' : 'human',
          human_approved: actor !== 'automatic-api',
          actor,
          skeleton_version: result.snapshot.skeleton_version,
          skeleton_hash: result.snapshot.skeleton_hash,
        };
      delete run.result.blocking;
      delete run.result.next_action;
      run.phase = 'export';
      const dir = this.runDir(run.run_id);
      await mkdir(dir, { recursive: true });
      const files: Record<string, string> = {};
      for (const [format, name] of Object.entries(fileNames)) {
        const content = result.files[format as keyof typeof fileNames];
        if (content === null) continue;
        await atomicWrite(join(dir, name), content);
        files[format] = `/api/v1/agent/runs/${run.run_id}/files/${name}`;
      }
      const snapshot = result.snapshot;
      run.status = result.job.status === 'succeeded' ? 'succeeded' : 'needs_review';
      run.result.files = files;
      run.result.materials = snapshot.materials.map((m) => ({
        id: m.id,
        type: m.type,
        title: m.title,
        topic_id: m.topic_id,
        questions: m.questions.length,
        slides: m.slides.length,
      }));
      run.result.generation = snapshot.generation ?? null;
      const failed = (snapshot.generation as { failed?: string[] } | undefined)?.failed ?? [];
      if (failed.length)
        run.result.next_action = `Не завершено частей: ${failed.length}. Повторите POST /api/v1/agent/runs/${run.run_id}/retry. Готовые материалы сохранены.`;
      run.result.audit = {
        technical_ready: snapshot.audit.technical_ready,
        checks: snapshot.audit.checks.map((c) => ({
          title: c.title,
          status: c.status,
          actual: c.actual,
        })),
        issues: snapshot.audit.issues,
      };
      run.result.checklist = engine.checklist(snapshot);
      run.result.total_ms = Date.now() - Date.parse(run.created_at);
      this.event(run, 'done', `Комплект собран, файлов: ${Object.keys(files).length}`);
    } catch (error) {
      this.fail(run, error);
    }
    await this.save(run);
  }
}

export class AgentStorageError extends Error {
  readonly status = 503;
  constructor() {
    super(
      'Не удалось сохранить сборку на диск. Проверьте свободное место и права доступа; готовые части остаются в памяти сервера.',
    );
  }
}

function describeFailure(error: unknown, fallback = 'internal') {
  const code =
    error instanceof AgentStorageError
      ? 'storage'
      : ((error as { code?: string })?.code ?? fallback);
  const retryable = !['rejected'].includes(code);
  const action =
    code === 'storage'
      ? 'Восстановите доступ к хранилищу, затем повторите незавершённые шаги.'
      : code === 'rate_limited'
        ? 'Шлюз занят или исчерпан бюджет команды. Проверьте лимит и повторите позже.'
        : code === 'rejected'
          ? 'Проверьте параметры запроса; повтор без исправлений не поможет.'
          : 'Готовые части сохранены. Повторите незавершённые шаги через /retry.';
  return { code, retryable, action };
}

async function atomicWrite(path: string, content: string | Uint8Array) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, path);
  } catch {
    await rm(temporary, { force: true }).catch(() => {});
    throw new AgentStorageError();
  }
}

function describe(usage: CallUsage) {
  const model = usage.model.split('/').pop();
  return usage.cached
    ? `${model}, из кэша`
    : `${model}, ${usage.prompt_tokens + usage.completion_tokens} токенов, ${(usage.duration_ms / 1000).toFixed(1)} с, ${usage.cost_rub.toFixed(2)} ₽`;
}

type SnapshotLike = {
  course_id: string;
  course_version: number;
  skeleton_version: number;
  skeleton_hash: string;
  skeleton: {
    goal: string;
    tasks: string[];
    requirements: {
      title: string;
      template_id: string;
      total_hours: string;
      calendar: unknown;
      references: unknown;
      model_design?: { module_titles: string[]; design_notes?: unknown };
    };
    assessments: unknown[];
    sessions?: unknown[];
    outcomes: Array<{
      id: string;
      kind: string;
      description: string;
      criteria?: string[];
      professional_standard_code?: string;
    }>;
    topics: Array<{
      id: string;
      module_id: string;
      title: string;
      planned_total: string;
      hours: Record<string, string>;
      outcome_ids: string[];
      control: string;
    }>;
  };
  audit: {
    issues: Array<{
      id: string;
      message: string;
      blocking: boolean;
      fix?: string;
      dismissible?: boolean;
      suggested_fix: string;
    }>;
  };
};

// Каркас в ответе API — то, что утверждает методист: цель, результаты и учебный план с часами.
function skeletonView(snapshot: SnapshotLike, issues: string[]) {
  const s = snapshot.skeleton;
  const moduleTitles = s.requirements.model_design?.module_titles ?? [];
  return {
    course_id: snapshot.course_id,
    course_version: snapshot.course_version,
    document: s,
    calendar: s.requirements.calendar,
    references: s.requirements.references,
    assessments: s.assessments,
    sessions: s.sessions ?? [],
    version: snapshot.skeleton_version,
    hash: snapshot.skeleton_hash,
    title: s.requirements.title,
    template_id: s.requirements.template_id,
    total_hours: s.requirements.total_hours,
    goal: s.goal,
    tasks: s.tasks,
    design_notes: s.requirements.model_design?.design_notes ?? null,
    outcomes: s.outcomes.map((o, i) => ({
      code: `РО ${i + 1}`,
      kind: o.kind,
      description: o.description,
      criteria: o.criteria ?? [],
      professional_standard_code: o.professional_standard_code,
    })),
    curriculum: s.topics.map((t) => ({
      id: t.id,
      module:
        t.module_id === 'module-final'
          ? 'Итоговая аттестация'
          : (moduleTitles[Number(t.module_id.replace('module-', '')) - 1] ?? t.module_id),
      title: t.title,
      total: t.planned_total,
      hours: t.hours,
      outcomes: t.outcome_ids.map((id) => `РО ${Number(id.replace('outcome-', ''))}`),
      control: t.control,
    })),
    model_issues: issues,
    audit_issues: snapshot.audit.issues.map((i) => ({
      id: i.id,
      blocking: i.blocking,
      message: i.message,
      can_apply: Boolean(i.fix),
      dismissible: Boolean(i.dismissible),
      suggested_fix: i.suggested_fix,
    })),
  };
}
