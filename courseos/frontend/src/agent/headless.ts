// Сборка курса без браузера для единого API-эндпоинта агента. Сервер передаёт сюда
// сводку и каркас от модели, а курс проходит те же шаги и проверки движка, что и в
// интерфейсе: каркас → утверждение → материалы → аудит. Хранилище — в памяти процесса.
import { DemoCourseApi } from '../entities/course/api/demo-course-api';
import type { ContentSteps } from '../entities/course/model/content-generation';
import { emptyRequirements } from '../entities/course/model/presets';
import { professionalStandardReferences } from '../entities/course/model/professional-standards';
import { generalRequirements, requestChecklist } from '../entities/course/model/checklist';
import type {
  ClarifyingQuestion,
  ModelDesign,
  Requirements,
  Snapshot,
} from '../entities/course/model/schema';

export type { ContentSteps } from '../entities/course/model/content-generation';

class MemoryStorage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

// Движок курса хранит данные в localStorage; на сервере его заменяет хранилище в памяти.
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

export interface SummaryParameters {
  title: string;
  template_id: Requirements['template_id'];
  audience: string;
  entry_level: string;
  goal: string;
  total_hours: string;
  delivery: string;
  assessment: string;
  constraints: string;
  weeks: number | null;
  daily_limit: string;
}

// Профстандарт подбирается только из локального каталога с полными текстами:
// придумать код нельзя, поэтому без совпадения программа остаётся без стандарта,
// а чек-лист показывает это методисту.
const standardScenarios: Array<[string, RegExp]> = [
  ['teachers', /учител|педагог|школ[ыа] (?!программир)/i],
  ['security', /безопасн|кибер|защит[аы] информ/i],
  ['devops', /devops|linux|администр|инфраструктур|ci\/cd|kubernetes|docker/i],
  ['bank', /данн|аналитик|аналит|python|sql|pandas|big data|машинн/i],
];

export function standardScenario(parameters: SummaryParameters) {
  if (parameters.template_id !== 'acr_professional') return null;
  const text = `${parameters.title} ${parameters.goal} ${parameters.audience}`;
  return standardScenarios.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

function nextMonday(from: Date) {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

export function makeRequirements(input: {
  request: string;
  parameters: SummaryParameters;
  design: ModelDesign;
  questions: ClarifyingQuestion[];
  answers: Record<string, string>;
  actor: string;
  now?: Date;
}): Requirements {
  const { parameters } = input;
  const scenario = standardScenario(parameters);
  const weeks = parameters.weeks;
  return {
    ...structuredClone(emptyRequirements),
    request: input.request,
    title: parameters.title,
    template_id: parameters.template_id,
    audience: parameters.audience,
    entry_level: parameters.entry_level,
    goal: parameters.goal,
    total_hours: parameters.total_hours,
    delivery: parameters.delivery,
    assessment: parameters.assessment,
    constraints: parameters.constraints,
    calendar: {
      ...emptyRequirements.calendar,
      // Срок из запроса начинается с ближайшего понедельника; дату старта уточняет методист.
      start: weeks ? nextMonday(input.now ?? new Date()) : '',
      calendar_days: weeks ? Math.round(weeks * 7) : 0,
      daily_limit: parameters.daily_limit,
      description: weeks ? `${weeks} нед. по запросу` : '',
    },
    references: scenario ? professionalStandardReferences(scenario) : [],
    parameters_confirmation: {
      request: input.request,
      actor: input.actor,
      at: (input.now ?? new Date()).toISOString(),
    },
    model_design: input.design,
    model_questions: input.questions,
    clarification_answers: input.answers,
  };
}

export interface AgentEvent {
  step: string;
  detail: string;
}

export interface AgentDecision {
  issue: string;
  action: 'applied' | 'accepted_as_is';
  reason: string;
}

const terminal = new Set(['succeeded', 'needs_review', 'failed', 'cancelled']);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(api: DemoCourseApi, courseId: string, statuses: Set<string>) {
  for (;;) {
    const view = await api.get(courseId);
    if (statuses.has(view.job.status)) return view;
    await pause(300);
  }
}

// Блокирующие находки перед утверждением: предложение агента применяется, остальное
// допускаемое оставляется как есть с причиной. Каждое решение возвращается в ответе API.
async function settleBlocking(api: DemoCourseApi, courseId: string, decisions: AgentDecision[]) {
  for (let round = 0; round < 20; round++) {
    const view = await api.get(courseId);
    const snapshot = view.snapshot!;
    const issue = snapshot.audit.issues.find((i) => i.blocking && (i.fix || i.dismissible));
    if (!issue) return snapshot;
    const envelope = {
      course_id: courseId,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
    };
    if (issue.fix) {
      await api.command({ ...envelope, action: 'apply_finding', payload: { issue_id: issue.id } });
      decisions.push({ issue: issue.message, action: 'applied', reason: issue.suggested_fix });
    } else {
      const reason =
        'Оставлено агентом при автоматическом утверждении через API; требуется проверка методистом.';
      await api.command({
        ...envelope,
        action: 'dismiss_finding',
        payload: { issue_id: issue.id, reason },
      });
      decisions.push({ issue: issue.message, action: 'accepted_as_is', reason });
    }
  }
  return (await api.get(courseId)).snapshot!;
}

export interface CourseFiles {
  json: string;
  markdown: string;
  docx: Uint8Array | null;
  pptx: Uint8Array | null;
  lms: string | null;
}

async function exportFiles(api: DemoCourseApi, snapshot: Snapshot): Promise<CourseFiles> {
  const file = async (format: 'docx' | 'pptx' | 'lms') => {
    const entry = snapshot.export_manifest.find((f) => f.format === format);
    if (entry?.status !== 'ready' || !entry.file_id) return null;
    return api.downloadFile(entry.file_id);
  };
  const [json, markdown, docx, pptx, lms] = await Promise.all([
    api.exportJson(snapshot.course_id, snapshot.course_version),
    api.exportMarkdown(snapshot.course_id, snapshot.course_version),
    file('docx'),
    file('pptx'),
    file('lms'),
  ]);
  const bytes = async (blob: Blob | null) =>
    blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  return {
    json: await json.text(),
    markdown: await markdown.text(),
    docx: await bytes(docx),
    pptx: await bytes(pptx),
    lms: lms ? await lms.text() : null,
  };
}

export function checklist(snapshot: Snapshot) {
  return [...generalRequirements(snapshot), ...requestChecklist(snapshot)].map((item) => ({
    title: item.title,
    status: item.status,
    evidence: item.evidence,
  }));
}

export async function buildSkeleton(requirements: Requirements, contentSteps: ContentSteps) {
  const api = new DemoCourseApi({ contentSteps });
  const started = await api.command({
    action: 'start',
    payload: requirements,
    request_id: crypto.randomUUID(),
  });
  const view = await waitFor(
    api,
    started.course_id,
    new Set(['awaiting_approval', 'awaiting_clarification', ...terminal]),
  );
  return { api, courseId: started.course_id, snapshot: view.snapshot, job: view.job };
}

export async function approveAndGenerate(
  api: DemoCourseApi,
  courseId: string,
  actor: string,
  onEvent: (event: AgentEvent) => void = () => {},
) {
  const decisions: AgentDecision[] = [];
  const settled = await settleBlocking(api, courseId, decisions);
  const blocking = settled.audit.issues.filter((i) => i.blocking);
  if (blocking.length)
    return {
      decisions,
      blocking,
      snapshot: settled,
      files: null,
      job: (await api.get(courseId)).job,
    };
  await api.command({
    action: 'approve',
    course_id: courseId,
    expected_version: settled.course_version,
    request_id: crypto.randomUUID(),
    payload: { skeleton_version: settled.skeleton_version, skeleton_hash: settled.skeleton_hash },
  });
  onEvent({
    step: 'approval',
    detail: `Каркас версии ${settled.skeleton_version} утверждён: ${actor}`,
  });
  let reported = 0;
  for (;;) {
    const view = await api.get(courseId);
    const steps = view.job.steps.filter(
      (s) => s.startsWith('Сгенерировано') || s.startsWith('Не сгенерировано'),
    );
    for (const step of steps.slice(reported)) onEvent({ step: 'content', detail: step });
    reported = steps.length;
    if (terminal.has(view.job.status)) {
      const snapshot = view.snapshot!;
      return {
        decisions,
        blocking: [],
        snapshot,
        files: await exportFiles(api, snapshot),
        job: view.job,
      };
    }
    await pause(500);
  }
}
