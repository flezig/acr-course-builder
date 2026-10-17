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

const monthWords: Record<string, number> = {
  одного: 1,
  полутора: 1.5,
  двух: 2,
  трех: 3,
  четырех: 4,
};
const countWords: Record<string, number> = { один: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5 };
// Дни недели занятий по их числу: равномерно, без выходных.
const weekdayPatterns: Record<number, number[]> = {
  1: [3],
  2: [2, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
};

// Срок и расписание: из запроса, если они там есть, иначе агент предлагает срок сам
// и возвращает это как допущение, которое методист видит в ответе.
export function calendarFromRequest(
  request: string,
  parameters: SummaryParameters,
  now: Date,
): { calendar: Requirements['calendar']; assumptions: string[] } {
  const total = Number(parameters.total_hours);
  const start = nextMonday(now);
  const base = { ...emptyRequirements.calendar, start };
  const sessions = request.match(/(\d+|один|два|две|три|четыре|пять)\s+раз[а]?\s+в\s+неделю/i);
  const duration = request.match(
    /по\s+(\d+(?:[.,]\d+)?)\s*(?:академическ[а-яё]*\s+)?(?:час|ч\b)/i,
  )?.[1];
  const perWeek = sessions ? (countWords[sessions[1].toLowerCase()] ?? Number(sessions[1])) : 0;
  if (perWeek >= 1 && perWeek <= 5 && duration) {
    const hours = Number(duration.replace(',', '.'));
    const weeks = parameters.weeks ?? Math.ceil(total / (perWeek * hours));
    return {
      calendar: {
        ...base,
        schedule: {
          weekdays: weekdayPatterns[perWeek],
          sessions_per_week: perWeek,
          duration: String(hours),
          confirmed: true,
        },
        calendar_days: weeks * 7,
        daily_limit: parameters.daily_limit || String(hours),
        confirmed: true,
        description: `${Math.ceil(total / hours)} занятий по ${hours} ч, ${perWeek} раза в неделю, ${weeks} нед.`,
      },
      assumptions: [
        `Дни занятий не указаны: агент поставил ${weekdayPatterns[perWeek].map((d) => ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d]).join(' и ')} с ${start}.`,
      ],
    };
  }
  const months = request.match(
    /(?:(одного|полутора|двух|тр[её]х|четыр[её]х|\d+(?:[.,]\d+)?)\s+)?месяц[а-яё]*/i,
  );
  if (!parameters.weeks && months) {
    const count = months[1]
      ? (monthWords[months[1].toLowerCase().replace('ё', 'е')] ??
        Number(months[1].replace(',', '.')))
      : 1;
    const limit = Number(parameters.daily_limit);
    const needed = limit ? Math.ceil(total / limit) : 0;
    let days = Math.round(count * 30);
    const assumptions = [`Срок «${months[0]}» взят как ${days} календарных дней с ${start}.`];
    // «Около двух месяцев» допускает небольшой запас: если при дневном лимите объём
    // не помещается в 60 дней, но помещается в +15 %, срок продлевается до нужного.
    if (/около|примерно|приблизительно/i.test(request) && needed > days && needed <= days * 1.15) {
      assumptions.push(
        `При нагрузке до ${limit} ч в день ${total} ч занимают ${needed} дней: срок «${months[0]}» уточнён до ${needed} дней.`,
      );
      days = needed;
    }
    return {
      calendar: {
        ...base,
        calendar_days: days,
        daily_limit: parameters.daily_limit,
        description: `${months[0]} по запросу: ${days} дней`,
      },
      assumptions,
    };
  }
  if (parameters.weeks)
    return {
      calendar: {
        ...base,
        calendar_days: Math.round(parameters.weeks * 7),
        daily_limit: parameters.daily_limit,
        description: `${parameters.weeks} нед. по запросу`,
      },
      assumptions: [`Дата начала не указана: агент поставил ближайший понедельник ${start}.`],
    };
  const limit = Number(parameters.daily_limit) || 4;
  const weeks = Math.max(1, Math.ceil(total / (limit * 5)));
  return {
    calendar: {
      ...base,
      calendar_days: weeks * 7,
      daily_limit: parameters.daily_limit,
      description: `Срок не указан в запросе; агент предложил ${weeks} нед.`,
    },
    assumptions: [
      `Срок обучения не указан: агент предложил ${weeks} нед. по будням до ${limit} ч в день с ${start}; срок подтверждает методист.`,
    ],
  };
}

export function makeRequirements(input: {
  request: string;
  parameters: SummaryParameters;
  design: ModelDesign;
  questions: ClarifyingQuestion[];
  answers: Record<string, string>;
  actor: string;
  now?: Date;
}): { requirements: Requirements; assumptions: string[] } {
  const { parameters } = input;
  const now = input.now ?? new Date();
  const scenario = standardScenario(parameters);
  const { calendar, assumptions } = calendarFromRequest(input.request, parameters, now);
  if (parameters.template_id === 'acr_professional' && !scenario)
    assumptions.push(
      'Профстандарт из локального каталога не подошёл: связь с трудовыми функциями подбирает методист.',
    );
  return {
    requirements: {
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
      calendar,
      references: scenario ? professionalStandardReferences(scenario) : [],
      parameters_confirmation: {
        request: input.request,
        actor: input.actor,
        at: now.toISOString(),
      },
      model_design: input.design,
      model_questions: input.questions,
      clarification_answers: input.answers,
    },
    assumptions,
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
