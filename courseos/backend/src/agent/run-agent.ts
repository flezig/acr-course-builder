import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  generateTopicMaterials,
  testInputSchema,
  topicInputSchema,
} from '../steps/generate-materials.ts';
import { parseRequest, type ParsedRequest } from '../steps/parse-request.ts';
import { reviewCourse, reviewInputSchema } from '../steps/review-course.ts';

// Единый эндпоинт агента: один вызов проводит запрос методиста через все шаги —
// разбор → уточнения → каркас → утверждение → материалы → самопроверка → выгрузки.
// Сборку курса, часы и проверки выполняет тот же движок, что и интерфейс
// (frontend/src/agent/headless.ts, собирается командой npm run build:agent).

export const agentRequestSchema = z.object({
  request: z.string().trim().min(1).max(8000),
  // Ответы на уточняющие вопросы прошлого вызова свободным текстом: добавляются к запросу.
  clarifications: z.string().trim().max(4000).default(''),
  // Ответы на содержательные вопросы модели: ключ — id или текст вопроса.
  answers: z.record(z.string(), z.string()).default({}),
  // false — остановиться после каркаса и ждать POST /api/v1/agent/runs/{id}/approve.
  approve: z.boolean().default(true),
  // false — сразу вернуть run_id, ход сборки смотреть в GET /api/v1/agent/runs/{id}.
  wait: z.boolean().default(true),
});

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

// Поля сводки, без которых каркас не строится; спрашиваем их до вызова модели для каркаса.
function missingSummary(parameters: ParsedRequest) {
  const hours = Number(parameters.total_hours);
  return [
    parameters.template_id === 'unknown' &&
      'Какой тип программы нужен: повышение квалификации или общеразвивающая?',
    !(hours >= 16 && hours <= 500) && 'Какой объём программы в академических часах (16–500)?',
    !parameters.audience && 'Кто слушатели программы?',
    !parameters.entry_level && 'Какой входной уровень подготовки у слушателей?',
    !parameters.delivery && 'В какой форме проходит обучение: очно, заочно, дистанционно?',
    !parameters.assessment && 'Какая форма итоговой аттестации предусмотрена?',
  ].filter((question): question is string => Boolean(question));
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
    issues: Array<{ message: string; blocking: boolean; severity: string; check_type: string }>;
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
  }): unknown;
  buildSkeleton(
    requirements: unknown,
    steps: unknown,
  ): Promise<{
    api: unknown;
    courseId: string;
    snapshot: EngineSnapshot | null;
    job: { status: string; next_action: string };
  }>;
  approveAndGenerate(
    api: unknown,
    courseId: string,
    actor: string,
    onEvent: (event: { step: string; detail: string }) => void,
  ): Promise<{
    decisions: unknown[];
    blocking: Array<{ message: string }>;
    snapshot: EngineSnapshot;
    files: Record<keyof typeof fileNames, string | Uint8Array | null> | null;
    job: { status: string };
  }>;
  checklist(snapshot: EngineSnapshot): unknown;
}

export class AgentRunner {
  private readonly gateway: LlmGateway;
  private readonly dataDir: string;
  private readonly bundlePath: string;
  private readonly runs = new Map<string, Run>();
  // Курсы, ожидающие утверждения: движок и id курса живут в памяти процесса.
  private readonly pending = new Map<string, { api: unknown; courseId: string }>();
  // Сборки идут по одной: шлюз всё равно пропускает два запроса, а движок курса
  // держит одно хранилище в памяти.
  private queue: Promise<unknown> = Promise.resolve();
  private headless?: Promise<Headless>;

  constructor(gateway: LlmGateway, dataDir: string, bundlePath: string) {
    this.gateway = gateway;
    this.dataDir = dataDir;
    this.bundlePath = bundlePath;
  }

  private engine() {
    this.headless ??= import(pathToFileURL(resolve(this.bundlePath)).href) as Promise<Headless>;
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
    const done = (this.queue = this.queue.then(() => this.execute(run)));
    if (request.wait) await done;
    return run;
  }

  async approve(id: string) {
    const run = await this.get(id);
    const pending = this.pending.get(id);
    if (!run || run.status !== 'awaiting_approval' || !pending) return null;
    run.status = 'queued';
    const done = (this.queue = this.queue.then(() => this.generate(run, 'methodist-api')));
    if (run.request.wait) await done;
    return run;
  }

  async get(id: string): Promise<Run | null> {
    const inMemory = this.runs.get(id);
    if (inMemory) return inMemory;
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    return readFile(join(this.runDir(id), 'run.json'), 'utf8').then(
      (text) => JSON.parse(text) as Run,
      () => null,
    );
  }

  async file(id: string, name: string) {
    if (!(name in contentTypes) || !/^[0-9a-f-]{36}$/.test(id)) return null;
    const body = await readFile(join(this.runDir(id), name)).catch(() => null);
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

  private async save(run: Run) {
    await mkdir(this.runDir(run.run_id), { recursive: true });
    await writeFile(join(this.runDir(run.run_id), 'run.json'), JSON.stringify(run, null, 1));
  }

  private async execute(run: Run) {
    run.status = 'running';
    try {
      await this.design(run);
      if (run.status === 'running' && run.request.approve) await this.generate(run, 'api-client');
    } catch (error) {
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      this.event(run, 'error', run.error);
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
    const missing = missingSummary(parameters);
    if (missing.length) {
      // Неполный запрос: агент не достраивает параметры сам, а спрашивает методиста.
      run.status = 'awaiting_clarification';
      run.result.questions = missing;
      run.result.next_action =
        'Повторите POST /api/v1/agent с тем же request и ответами в поле clarifications.';
      this.event(run, 'clarification', `Нужны ответы методиста: ${missing.length}`);
      return;
    }
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
      total_hours: Number(parameters.total_hours),
      answers: answered.map((q) => ({ question: q.label, answer: q.answer })),
    });
    run.calls.push({ ...draft.design.generated_by, label: 'Каркас программы' });
    this.event(run, 'draft_skeleton', `Структура каркаса: ${describe(draft.design.generated_by)}`);
    const engine = await this.engine();
    const requirements = engine.makeRequirements({
      request: fullRequest,
      parameters,
      design: { ...draft.design, issues: draft.issues },
      questions,
      answers: Object.fromEntries(answered.map((q) => [q.id, q.answer])),
      actor: 'api-client',
    });
    const built = await engine.buildSkeleton(requirements, this.contentSteps(run));
    if (!built.snapshot) throw new Error(`Каркас не построен: ${built.job.next_action}`);
    this.pending.set(run.run_id, { api: built.api, courseId: built.courseId });
    run.result.skeleton = skeletonView(built.snapshot, draft.issues);
    this.event(
      run,
      'skeleton',
      `Каркас готов: ${built.snapshot.skeleton.topics.length} строк учебного плана, ${built.snapshot.skeleton.outcomes.length} результатов`,
    );
    run.result.skeleton_ms = Date.now() - Date.parse(run.created_at);
    if (!run.request.approve) {
      run.status = 'awaiting_approval';
      run.result.next_action = `Проверьте каркас и вызовите POST /api/v1/agent/runs/${run.run_id}/approve.`;
    }
  }

  private async generate(run: Run, actor: string) {
    run.status = 'running';
    const pending = this.pending.get(run.run_id)!;
    const engine = await this.engine();
    try {
      const result = await engine.approveAndGenerate(
        pending.api,
        pending.courseId,
        actor,
        (event) => this.event(run, event.step, event.detail),
      );
      run.result.decisions = result.decisions;
      if (!result.files) {
        run.status = 'blocked';
        run.result.blocking = result.blocking.map((issue) => issue.message);
        run.result.next_action = 'Есть блокирующие замечания, которые агент не может снять сам.';
        return;
      }
      this.pending.delete(run.run_id);
      const dir = this.runDir(run.run_id);
      await mkdir(dir, { recursive: true });
      const files: Record<string, string> = {};
      for (const [format, name] of Object.entries(fileNames)) {
        const content = result.files[format as keyof typeof fileNames];
        if (content === null) continue;
        await writeFile(join(dir, name), content);
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
      run.result.audit = {
        technical_ready: snapshot.audit.technical_ready,
        checks: snapshot.audit.checks.map((c) => ({
          title: c.title,
          status: c.status,
          actual: c.actual,
        })),
        issues: snapshot.audit.issues.map((i) => ({
          severity: i.severity,
          check_type: i.check_type,
          blocking: i.blocking,
          message: i.message,
        })),
      };
      run.result.checklist = engine.checklist(snapshot);
      run.result.total_ms = Date.now() - Date.parse(run.created_at);
      this.event(run, 'done', `Комплект собран, файлов: ${Object.keys(files).length}`);
    } catch (error) {
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      this.event(run, 'error', run.error);
    }
    await this.save(run);
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
  skeleton_version: number;
  skeleton_hash: string;
  skeleton: {
    goal: string;
    tasks: string[];
    requirements: {
      title: string;
      template_id: string;
      total_hours: string;
      model_design?: { module_titles: string[] };
    };
    outcomes: Array<{ id: string; kind: string; description: string; criteria?: string[] }>;
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
  audit: { issues: Array<{ message: string; blocking: boolean }> };
};

// Каркас в ответе API — то, что утверждает методист: цель, результаты и учебный план с часами.
function skeletonView(snapshot: SnapshotLike, issues: string[]) {
  const s = snapshot.skeleton;
  const moduleTitles = s.requirements.model_design?.module_titles ?? [];
  return {
    course_id: snapshot.course_id,
    version: snapshot.skeleton_version,
    hash: snapshot.skeleton_hash,
    title: s.requirements.title,
    template_id: s.requirements.template_id,
    total_hours: s.requirements.total_hours,
    goal: s.goal,
    tasks: s.tasks,
    outcomes: s.outcomes.map((o, i) => ({
      code: `РО ${i + 1}`,
      kind: o.kind,
      description: o.description,
      criteria: o.criteria ?? [],
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
    audit_issues: snapshot.audit.issues.map((i) => ({ blocking: i.blocking, message: i.message })),
  };
}
