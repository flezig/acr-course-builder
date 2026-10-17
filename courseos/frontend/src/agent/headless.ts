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
const countWords: Record<string, number> = {
  один: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
};
// Предложение дней по числу занятий; методист подтверждает его отдельно.
const weekdayPatterns: Record<number, number[]> = {
  1: [3],
  2: [2, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 0],
};

const dateMonths = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

function requestStart(request: string, now: Date) {
  const datePattern = `\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./]\\d{1,2}(?:[./]\\d{4})?|\\d{1,2}\\s+(?:${dateMonths.join('|')})(?:\\s+\\d{4})?`;
  const match = request.match(
    new RegExp(
      `(?<![а-яёa-z])(?:дата\\s+начала|начало(?:\\s+(?:обучения|курса|занятий))?|старт(?:\\s+(?:обучения|курса))?|начать|с)\\s*[:—-]?\\s*(?:с\\s+)?(${datePattern})(?!\\d)`,
      'iu',
    ),
  );
  if (!match) {
    const start = nextMonday(now);
    return {
      start,
      assumptions: [`Дата начала не указана: агент предложил ближайший понедельник ${start}.`],
    };
  }
  const text = match[1].toLowerCase();
  const parts = text.split(/[./\s-]+/);
  const iso = /^\d{4}-/.test(text);
  const day = Number(parts[iso ? 2 : 0]);
  const month = /^\d+$/.test(parts[1]) ? Number(parts[1]) : dateMonths.indexOf(parts[1]) + 1;
  const explicitYear = iso || parts.length === 3;
  let year = explicitYear ? Number(parts[iso ? 0 : 2]) : now.getUTCFullYear();
  // Без года берём ближайшую будущую дату, но сообщаем об этом как о допущении.
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!explicitYear && Date.UTC(year, month - 1, day) < today) year++;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error(`Дата начала «${match[1]}» некорректна. Уточните дату начала обучения.`);
  return {
    start: date.toISOString().slice(0, 10),
    assumptions: explicitYear
      ? []
      : [`Год начала не указан: агент предложил ${year} год; подтвердите дату.`],
  };
}

function requestWeekdays(request: string) {
  const names = [
    'воскресень(?:е|я|ям|ю|ем)|вс',
    'понедельник(?:а|ам|и|у|ом)?|пн',
    'вторник(?:а|ам|и|у|ом)?|вт',
    'сред(?:а|ам|у|ы|е)|ср',
    'четверг(?:а|ам|и|у|ом)?|чт',
    'пятниц(?:а|ам|у|ы|е)|пт',
    'суббот(?:а|ам|у|ы|е)|сб',
  ];
  const day = `(?<![а-яёa-z])(?:${names.join('|')})(?![а-яёa-z])`;
  const span = `${day}(?:\\s*[-–—]\\s*${day})?`;
  const list = `${span}(?:\\s*(?:,|и|/)\\s*(?:(?:по|в)\\s+)?${span})*`;
  // Контекст занятий отделяет расписание от упоминаний дней в заданиях и сроках сдачи.
  const match =
    request.match(
      new RegExp(
        `(?:занятия\\s+(?:(?:проходят|проводятся)\\s+)?(?:(?:по|в)\\s+)?|по\\s+|(?:расписание|дни занятий)\\s*[:—-]?\\s*)(${list})`,
        'iu',
      ),
    ) ?? request.match(new RegExp(`(${day}\\s*(?:,|и|/|[-–—])\\s*${list})`, 'iu'));
  if (!match) return [];
  const dayNumber = (name: string) =>
    names.findIndex((pattern) => new RegExp(`^(?:${pattern})$`, 'iu').test(name));
  const days: number[] = [];
  for (const token of match[1].matchAll(new RegExp(`(${day})(?:\\s*[-–—]\\s*(${day}))?`, 'giu'))) {
    const first = dayNumber(token[1]);
    const last = token[2] ? dayNumber(token[2]) : first;
    for (let day = first; ; day = (day + 1) % 7) {
      days.push(day);
      if (day === last) break;
    }
  }
  return [...new Set(days)];
}

// Срок и расписание: из запроса, если они там есть, иначе агент предлагает срок сам
// и возвращает это как допущение, которое методист видит в ответе.
export function calendarFromRequest(
  request: string,
  parameters: SummaryParameters,
  now: Date,
): { calendar: Requirements['calendar']; assumptions: string[] } {
  const total = Number(parameters.total_hours);
  const { start, assumptions: startAssumptions } = requestStart(request, now);
  const base = { ...emptyRequirements.calendar, start };
  const weekdays = requestWeekdays(request);
  const sessions = request.match(
    /(\d+|один|два|две|три|четыре|пять|шесть|семь)\s+раз[а]?\s+в\s+неделю/i,
  );
  const duration = request.match(
    /по\s+(\d+(?:[.,]\d+)?)\s*(?:академическ[а-яё]*\s+)?(?:час|ч\b)/i,
  )?.[1];
  const perWeek = sessions
    ? (countWords[sessions[1].toLowerCase()] ?? Number(sessions[1]))
    : weekdays.length;
  if (weekdays.length && sessions && weekdays.length !== perWeek)
    throw new Error(
      `Указано ${perWeek} занятий в неделю, но дней занятий — ${weekdays.length}. Уточните расписание.`,
    );
  if (perWeek >= 1 && perWeek <= 7 && (duration || weekdays.length)) {
    const hours = Number((duration || parameters.daily_limit || '4').replace(',', '.'));
    if (!Number.isFinite(hours) || hours <= 0)
      throw new Error('Длительность занятия должна быть больше нуля. Уточните расписание.');
    const scheduleDays = weekdays.length ? weekdays : weekdayPatterns[perWeek];
    const weeks = parameters.weeks ?? Math.ceil(total / (perWeek * hours));
    const assumptions = [...startAssumptions];
    if (!weekdays.length)
      assumptions.push(
        `Дни занятий не указаны: агент предложил ${scheduleDays.map((d) => ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d]).join(' и ')}; подтвердите расписание.`,
      );
    if (!duration)
      assumptions.push(
        `Длительность занятия не указана: агент предложил ${hours} ч; подтвердите расписание.`,
      );
    return {
      calendar: {
        ...base,
        schedule: {
          weekdays: scheduleDays,
          sessions_per_week: perWeek,
          duration: String(hours),
          confirmed: !!weekdays.length && !!duration,
        },
        calendar_days: weeks * 7,
        daily_limit: parameters.daily_limit || String(hours),
        confirmed: !assumptions.length,
        description: `${Math.ceil(total / hours)} занятий по ${hours} ч, ${perWeek} раза в неделю, ${weeks} нед.`,
      },
      assumptions,
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
      assumptions: [...assumptions, ...startAssumptions],
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
      assumptions: startAssumptions,
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
      ...startAssumptions,
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
