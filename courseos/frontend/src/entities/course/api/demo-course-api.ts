import { scheduleCalculation } from '../model/schedule';
import { contentQuestions, unansweredContentQuestions } from '../model/demo-clarifications';
import { isProfessionalStandardReference } from '../model/professional-standards';
import { isElementEdit, previewElementEdit } from '../model/material-edit';
import { assessmentMaterial } from '../model/material-readiness';
import { courseMarkdown } from '../export/course-markdown';
import { courseJson } from '../export/course-json';
import Decimal from 'decimal.js';
import { invalidateRationales } from '../model/rationale';
import { z } from 'zod';
import {
  requirementsSchema,
  skeletonSchema,
  snapshotSchema,
  courseViewSchema,
  changePlanSchema,
  changeInputSchema,
  courseHoursSchema,
  jobSchema,
  type ChangePlan,
  type Generation,
  type Material,
  type Job,
  type Requirements,
  type Skeleton,
  type Snapshot,
} from '../model/schema';
import {
  approvalMatches,
  auditSnapshot,
  calendarCalculation,
  canAcceptException,
} from '../model/rules';
import {
  makeMaterials,
  makeSections,
  makeSkeleton,
  materialHash,
  missingQuestions,
  refreshExplanations,
} from '../model/factory';
import { contentHash, canonicalJson } from '../../../shared/lib/decimal';
import { proposedAssessment, proposedCalendar } from '../model/findings';
import { assessmentLabels } from '../model/presets';
import { ApiError } from '../../../shared/api/http';
import { httpContentSteps } from './http-content-steps';
import {
  generateContent,
  generationCost,
  type ContentSteps,
  type GenerationProgress,
} from '../model/content-generation';
import { applyGeneratedContent } from '../model/generated-materials';
import {
  aiEditOutcomeSchema,
  feedbackSchema,
  type AiEditOutcome,
  type AiEditOutcomeInput,
  type FeedbackInput,
  type FeedbackPatch,
  type ResponseFeedback,
} from '../model/feedback';
import {
  withManifest,
  type CommandEnvelope,
  type CommandResult,
  type CourseApi,
  type EditScope,
  type ScopeEditRequest,
} from './contract';
const storageKey = 'courseos-demo-v1';
// Генерация материалов моделью идёт вне транзакции хранилища: она длится минуты,
// а опрос задачи только забирает уже готовые части. После перезагрузки страницы
// генерация начинается заново, но сервер отдаёт готовые ответы из кэша бесплатно.
interface ContentRun {
  progress: GenerationProgress;
  settled: { materials: Material[]; generation: Generation } | null;
}
const contentRuns = new Map<string, ContentRun>();
function contentRun(jobId: string, skeleton: Skeleton, materials: Material[], steps: ContentSteps) {
  let run = contentRuns.get(jobId);
  if (!run) {
    const created: ContentRun = {
      progress: { done: [], content: { topics: [], test: null, final: null } },
      settled: null,
    };
    void generateContent(skeleton, materials, steps, (progress) => {
      created.progress = progress;
    }).then((value) => (created.settled = value));
    contentRuns.set(jobId, created);
    run = created;
  }
  return run;
}
// Отзывы и итоги правок ИИ лежат под своими ключами: их не затрагивают
// миграции и очистка истории курсов.
const feedbackStorageKey = 'courseos-feedback-demo';
const aiEditOutcomesStorageKey = 'courseos-ai-edit-outcomes-demo';
function loadList<T>(key: string, schema: z.ZodType<T>): T[] {
  const stored = localStorage.getItem(key);
  if (!stored) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    throw new ApiError(422, 'Отзывы в браузере не читаются. Сбросьте демо-данные в настройках.');
  }
  const parsed = z.array(schema).safeParse(raw);
  if (!parsed.success)
    throw new ApiError(422, 'Неизвестный формат отзывов в браузере. Сбросьте демо-данные.');
  return parsed.data;
}
function saveList(key: string, items: unknown[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    throw new ApiError(413, 'Хранилище браузера заполнено, отзыв не сохранён.');
  }
}
interface StoredCourse {
  requirements: Requirements;
  snapshots: Snapshot[];
  job: Job;
  approvals: Snapshot['approvals'];
  plans: ChangePlan[];
}
interface StoredDatabase {
  schema_version: number;
  recovery: Record<string, unknown>;
  courses: Record<string, StoredCourse>;
  operations: Record<string, { payload: string; result: CommandResult }>;
}
const storedCourseSchema = z.object({
  requirements: requirementsSchema,
  snapshots: z.array(snapshotSchema),
  job: jobSchema,
  approvals: z.array(snapshotSchema.shape.approvals.element),
  plans: z.array(changePlanSchema).default([]),
});
const storageVersion = 2;
function load(): StoredDatabase {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return { schema_version: storageVersion, courses: {}, operations: {}, recovery: {} };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stored);
  } catch {
    throw new ApiError(
      422,
      'Хранилище не читается. Скачайте исходные данные в разделе «Хранилище» до сброса.',
    );
  }
  if (
    !raw ||
    typeof raw !== 'object' ||
    !raw.courses ||
    typeof raw.courses !== 'object' ||
    (raw.schema_version !== undefined &&
      raw.schema_version !== 1 &&
      raw.schema_version !== storageVersion)
  )
    throw new ApiError(
      422,
      'Неизвестный формат хранилища. Исходные данные доступны для скачивания до сброса.',
    );
  const database: StoredDatabase = {
    schema_version: storageVersion,
    courses: {},
    operations: {},
    recovery:
      raw.recovery && typeof raw.recovery === 'object'
        ? (raw.recovery as Record<string, unknown>)
        : {},
  };
  // Совместимые поля старой схемы получают безопасные значения; каркас и его hash не меняются.
  for (const [id, course] of Object.entries(raw.courses)) {
    const parsed = storedCourseSchema.safeParse(course);
    if (parsed.success) {
      if (raw.schema_version !== storageVersion)
        for (const snapshot of parsed.data.snapshots) {
          snapshot.audit = auditSnapshot(snapshot);
          snapshot.approval_applicable = approvalMatches(snapshot);
        }
      database.courses[id] = parsed.data;
    } else database.recovery[id] = course;
  }
  const operationSchema = z.object({
    payload: z.string(),
    result: z.object({
      course_id: z.string(),
      job: jobSchema,
      change_plan: changePlanSchema.nullable(),
    }),
  });
  if (raw.operations && typeof raw.operations === 'object')
    for (const [key, operation] of Object.entries(raw.operations)) {
      const parsed = operationSchema.safeParse(operation);
      if (parsed.success) database.operations[key] = parsed.data;
    }
  return database;
}
const keptOperations = 200;
function save(database: StoredDatabase) {
  const operationKeys = Object.keys(database.operations);
  for (const key of operationKeys.slice(0, Math.max(0, operationKeys.length - keptOperations)))
    delete database.operations[key];
  try {
    localStorage.setItem(storageKey, JSON.stringify(database));
  } catch {
    throw new ApiError(
      413,
      'Хранилище браузера заполнено. Прежние данные сохранены. Скачайте архив в разделе «Хранилище» и явно сократите историю.',
    );
  }
}
const now = () => new Date().toISOString();
const active = (job: Job) => job.status === 'queued' || job.status === 'running';
function makeJob(courseId: string, operation: string, requestId: string): Job {
  return {
    id: crypto.randomUUID(),
    course_id: courseId,
    operation,
    request_id: requestId,
    status: 'queued',
    started_at: now(),
    updated_at: now(),
    completed_at: null,
    steps: [],
    next_action: 'Дождитесь завершения демонстрационной операции',
    error: null,
    usage: {
      tokens: null,
      cost: null,
      source: 'Детерминированная симуляция; модель не вызывалась, usage отсутствует',
    },
    attempt: 1,
    partial_materials: [],
  };
}
const latest = (course: StoredCourse) => course.snapshots.at(-1);
async function newSnapshot(
  courseId: string,
  course: StoredCourse,
  skeleton: Skeleton,
  materials: Snapshot['materials'] = [],
  previous?: Snapshot,
  generation?: Generation,
): Promise<Snapshot> {
  invalidateRationales(skeleton, previous?.skeleton);
  const snapshot: Snapshot = {
    schema_version: '1.0',
    course_id: courseId,
    course_version: (latest(course)?.course_version || 0) + 1,
    mode: 'demo',
    provenance: 'demo',
    created_at: now(),
    run_id: course.job.id,
    draft: true,
    skeleton_version: previous
      ? previous.skeleton_hash === (await contentHash(skeleton))
        ? previous.skeleton_version
        : previous.skeleton_version + 1
      : 1,
    skeleton_hash: await contentHash(skeleton),
    skeleton,
    materials,
    sections: [],
    sources: structuredClone(skeleton.requirements.references),
    edges: [],
    material_links: [],
    audit: {
      course_version: 0,
      at: now(),
      checks: [],
      issues: [],
      technical_ready: false,
      expert_status: 'not_reviewed',
    },
    observations: structuredClone(previous?.observations || []),
    decisions: structuredClone(previous?.decisions || []),
    approvals: course.approvals,
    approval_applicable: false,
    ...(generation ? { generation } : {}),
    changes: previous?.changes || [],
    export_manifest: [],
  };
  const finalized = finalize(snapshot);
  finalized.approval_at_creation = finalized.approval_applicable;
  return finalized;
}
function finalize(snapshot: Snapshot): Snapshot {
  const s = snapshot.skeleton;
  snapshot.material_links = s.assessments.flatMap((a) => {
    const m = assessmentMaterial(snapshot, a);
    return m ? [{ assessment_id: a.id, material_id: m.id }] : [];
  });
  snapshot.edges = [
    ...s.topics.flatMap((t) =>
      t.outcome_ids.map((id) => ({
        from_id: t.id,
        to_id: id,
        relation: 'covers',
        reason: t.content,
      })),
    ),
    ...s.activities.flatMap((a) =>
      a.outcome_ids.map((id) => ({
        from_id: a.id,
        to_id: id,
        relation: 'practices',
        reason: a.description,
      })),
    ),
    ...s.assessments.flatMap((a) =>
      a.outcome_ids.map((id) => ({
        from_id: a.id,
        to_id: id,
        relation: 'assesses',
        reason: a.criterion,
      })),
    ),
    ...snapshot.material_links.map((link) => ({
      from_id: link.material_id,
      to_id: link.assessment_id,
      relation: 'renders',
      reason: 'Материал реализует пункт утверждённого плана',
    })),
    ...s.topics.flatMap((t) =>
      t.prerequisite_ids.map((id) => ({
        from_id: id,
        to_id: t.id,
        relation: 'prerequisite',
        reason: 'Нужен навык предыдущей темы',
      })),
    ),
  ];
  snapshot.sections = snapshot.materials.length ? makeSections(snapshot) : [];
  snapshot.audit = auditSnapshot(snapshot);
  snapshot.approval_applicable = approvalMatches(snapshot);
  return withManifest(snapshot);
}
function affectedTopicMaterials(snapshot: Snapshot, topicId: string) {
  if (!snapshot.skeleton.topics.some((topic) => topic.id === topicId))
    throw new ApiError(422, 'Тема не найдена.');
  const topicIds = new Set([topicId]);
  // Зависимость может проходить через несколько тем и не совпадать с их порядком.
  let previousSize: number;
  do {
    previousSize = topicIds.size;
    for (const topic of snapshot.skeleton.topics)
      if (topic.prerequisite_ids.some((id) => topicIds.has(id))) topicIds.add(topic.id);
  } while (previousSize !== topicIds.size);
  const outcomeIds = new Set(
    snapshot.skeleton.topics
      .filter((topic) => topicIds.has(topic.id))
      .flatMap((topic) => topic.outcome_ids),
  );
  return snapshot.materials.filter(
    (material) =>
      topicIds.has(material.topic_id) || material.outcome_ids.some((id) => outcomeIds.has(id)),
  );
}
function projectMaterial(snapshot: Snapshot, materialId: string) {
  const material = snapshot.materials.find((item) => item.id === materialId);
  if (!material || !['project', 'portfolio', 'exam', 'mentor_interview'].includes(material.type))
    throw new ApiError(422, 'Выберите существующий проект или материал итогового оценивания.');
  return material;
}
async function advance(courseId: string, course: StoredCourse, steps: ContentSteps) {
  if (!active(course.job)) return;
  const elapsed = Date.now() - Date.parse(course.job.started_at);
  course.job.status = 'running';
  course.job.updated_at = now();
  if (course.job.operation === 'start' || course.job.operation === 'clarify') {
    if (elapsed < 400) return;
    const snapshot = await newSnapshot(courseId, course, makeSkeleton(course.requirements));
    course.snapshots.push(snapshot);
    course.job.steps = ['Параметры сохранены', 'Программа и пять объяснений подготовлены'];
    course.job.status = 'awaiting_approval';
    course.job.next_action = snapshot.skeleton.conflicts.some((c) => c.status === 'open')
      ? 'Разрешите конфликт, затем отдельно утвердите структуру программы'
      : 'Проверьте и утвердите структуру программы';
  } else {
    const base = latest(course)!;
    if (elapsed < 400) return;
    if (!base.approval_applicable) {
      course.job.status = 'failed';
      course.job.error = 'Нет применимого утверждения';
      course.job.next_action = 'Утвердите актуальную версию';
      return;
    }
    const topics = base.skeleton.topics.filter((t) => t.id !== 'topic-final');
    const completed = topics.slice(
      0,
      Math.min(topics.length, Math.max(1, Math.floor(elapsed / 250))),
    );
    course.job.steps = [
      ...new Set([...course.job.steps, ...completed.map((t) => `Сохранён шаг: ${t.title}`)]),
    ];
    let generated = await makeMaterials(base.skeleton);
    let generation: Generation | undefined;
    // Каркас от модели: тексты тем, тест и итоговую аттестацию пишет модель после утверждения.
    if (base.skeleton.requirements.model_design) {
      const run = contentRun(course.job.id, base.skeleton, generated, steps);
      course.job.steps = [
        ...new Set([
          ...course.job.steps,
          ...run.progress.done.map((label) => `Сгенерировано моделью: ${label}`),
        ]),
      ];
      if (!run.settled) {
        const total = base.skeleton.topics.length + 1;
        course.job.next_action = `Модель пишет материалы: готово ${run.progress.done.length} из ${total} частей (темы, тест, итоговая аттестация), затем самопроверка`;
        course.job.partial_materials = applyGeneratedContent(
          base.skeleton,
          generated,
          run.progress.content,
        ).filter((m) => run.progress.content.topics.some((t) => t.topic_id === m.topic_id));
        return;
      }
      generated = run.settled.materials;
      generation = run.settled.generation;
      for (const material of generated) material.hash = await materialHash(material);
      const { tokens, cost_rub } = generationCost(generation);
      course.job.usage = {
        tokens,
        cost: cost_rub.toFixed(2),
        source: `GigaChat через шлюз хакатона: ${generation.calls.length} вызовов`,
      };
      for (const failure of generation.failed)
        course.job.steps.push(`Не сгенерировано: ${failure}`);
    }
    // Повторная генерация зависимостей темы должна учитывать ранее согласованный проект.
    const projectPlans = new Map<string, ChangePlan>();
    for (const change of base.changes) {
      const plan = course.plans.find((item) => item.id === change.id);
      if (plan?.input.type === 'project') projectPlans.set(plan.input.target_id, plan);
    }
    for (const plan of projectPlans.values()) {
      for (const material of generated.filter((m) => plan.affected.some((a) => a.id === m.id))) {
        if (material.id === plan.input.target_id || material.type === 'seminar')
          material.content = plan.input.replacement;
        if (material.type === 'working_program')
          material.content += `\nУточнённое требование к проекту: ${plan.input.replacement}`;
        material.hash = await materialHash(material);
      }
    }
    const preserved = base.materials.filter((m) => !m.stale);
    const materials = generated.map((m) => preserved.find((p) => p.id === m.id) || m);
    const completedIds = new Set(completed.map((topic) => topic.id));
    const savedIds = new Set(course.job.partial_materials.map((material) => material.id));
    course.job.partial_materials.push(
      ...materials.filter(
        (material) => completedIds.has(material.topic_id) && !savedIds.has(material.id),
      ),
    );
    if (elapsed < 1800) return;
    contentRuns.delete(course.job.id);
    const snapshot = await newSnapshot(
      courseId,
      course,
      structuredClone(base.skeleton),
      materials,
      base,
      generation,
    );
    course.snapshots.push(snapshot);
    course.job.status = snapshot.audit.technical_ready ? 'succeeded' : 'needs_review';
    course.job.steps.push('Аудит и полный JSON сохранены');
    course.job.next_action = 'Проверьте материалы и неподтверждённые источники';
    course.job.completed_at = now();
  }
}
// Решение по календарю: подтверждение, продление, сокращение объёма или новый лимит.
// Используется и из календаря, и из очереди решений, когда агент предлагает календарь сам.
async function resolveCalendar(
  id: string,
  course: StoredCourse,
  base: Snapshot,
  option: 'confirm' | 'extend' | 'reduce' | 'raise',
  calendar: Requirements['calendar'],
) {
  const skeleton = structuredClone(base.skeleton);
  const before = canonicalJson(skeleton.requirements.calendar);
  calendar = requirementsSchema.shape.calendar.parse(calendar);
  const oldLimit = base.skeleton.requirements.calendar.daily_limit;
  if (
    option !== 'raise' &&
    oldLimit &&
    calendar.daily_limit &&
    new Decimal(calendar.daily_limit).gt(oldLimit)
  )
    throw new ApiError(
      422,
      `Исходный лимит ${oldLimit} ч/день нельзя повысить подтверждением. Выберите явное изменение дневной нагрузки.`,
    );
  const requestedRaise =
    option === 'raise' && !!oldLimit && new Decimal(calendar.daily_limit || 0).gt(oldLimit);
  if (option === 'raise' && oldLimit && !requestedRaise)
    calendar = { ...calendar, daily_limit: oldLimit };
  skeleton.requirements.calendar = calendar;
  const calculate = () =>
    scheduleCalculation(skeleton.requirements.calendar, skeleton.requirements.total_hours) ??
    calendarCalculation(skeleton.requirements);
  const schedule = scheduleCalculation(calendar, skeleton.requirements.total_hours);
  if (schedule?.error) throw new ApiError(422, schedule.error);
  let calc = calculate();
  if (option !== 'confirm' && !requestedRaise && new Decimal(calc.deficit).eq(0))
    throw new ApiError(422, 'Часов достаточно: изменение для устранения нехватки не требуется.');
  if (option === 'extend') {
    const maximum = { ...skeleton.requirements, calendar: { ...calendar, calendar_days: 3650 } };
    if (
      new Decimal(
        (
          scheduleCalculation(maximum.calendar, maximum.total_hours) ?? calendarCalculation(maximum)
        ).deficit,
      ).gt(0)
    )
      throw new ApiError(
        422,
        'При этой нагрузке срок превысит 3650 дней. Согласуйте другой лимит или объём.',
      );
    while (calc.needed !== null && calc.days < calc.needed) {
      skeleton.requirements.calendar.calendar_days++;
      calc = calculate();
    }
  }
  if (option === 'raise' && !requestedRaise) {
    if (!calc.minimumLimit) throw new ApiError(422, 'Укажите доступные учебные дни.');
    skeleton.requirements.calendar.daily_limit = Decimal.max(
      oldLimit || 0,
      calc.minimumLimit,
    ).toString();
    if (skeleton.requirements.calendar.schedule?.confirmed)
      skeleton.requirements.calendar.schedule.duration = calc.minimumLimit;
    skeleton.requirements.constraints += `\nРешение методиста: дневной лимит ${skeleton.requirements.calendar.daily_limit} ч/день.${skeleton.requirements.calendar.schedule?.confirmed ? ` Длительность занятия увеличена до ${calc.minimumLimit} ч.` : ''}`;
  }
  if (requestedRaise)
    skeleton.requirements.constraints += `\nРешение методиста: дневной лимит увеличен с ${oldLimit} до ${calendar.daily_limit} ч/день.`;
  if (option === 'reduce') {
    if (new Decimal(calc.capacity).lt(16))
      throw new ApiError(422, 'Вместимость меньше минимальных 16 часов.');
    if (!courseHoursSchema.safeParse(calc.capacity).success)
      throw new ApiError(
        422,
        'Полученная вместимость должна быть от 16 до 500 ч с шагом 0,5. Уточните календарь.',
      );
    skeleton.requirements.total_hours = calc.capacity;
    skeleton.requirements.constraints += `\nРешение методиста: вместо исходного объёма принят ${calc.capacity} ч; глубина результатов пересматривается до базовых действий по образцу.`;
  }
  skeleton.requirements.calendar.description = `${skeleton.requirements.calendar.calendar_days} календарных / ${calendarCalculation(skeleton.requirements).days} учебных дней, до ${skeleton.requirements.calendar.daily_limit} ч/день; ${skeleton.requirements.calendar.weekdays_only ? 'по будням' : 'ежедневно'}. Подтверждено методистом.`;
  const revised =
    option === 'reduce'
      ? makeSkeleton(skeleton.requirements, skeleton)
      : refreshExplanations(skeleton);
  revised.conflicts = revised.conflicts.filter((c) => c.id !== 'calendar-decision');
  revised.conflicts.push({
    id: 'calendar-decision',
    requirement_ids: ['calendar', 'total_hours'],
    status: 'resolved',
    expected: 'Решение методиста сохранено',
    actual: revised.requirements.calendar.description,
    calculation: `Новая вместимость: ${calendarCalculation(revised.requirements).capacity} ч`,
    options: [],
    decision: {
      option_id: option,
      actor: 'demo-methodist',
      at: now(),
      before,
      after: canonicalJson(revised.requirements),
    },
  });
  refreshExplanations(revised);
  course.requirements = revised.requirements;
  course.snapshots.push(
    await newSnapshot(
      id,
      course,
      revised,
      base.materials.map((m) => ({ ...m, stale: true })),
      base,
    ),
  );
  course.job.status = 'awaiting_approval';
  course.job.next_action =
    'Решение сохранено. Отдельно утвердите структуру программы после повторного расчёта.';
}
const demoOutcomeExample = (draft: Skeleton) => {
  const outcome = draft.outcomes[0];
  if (outcome)
    outcome.description = `${outcome.description.replace(/[.\s]+$/, '')} и объясняет своё решение на примере собственного кода`;
};
const demoScopeExample: Record<EditScope, (draft: Skeleton) => void> = {
  intent: (draft) => {
    draft.goal = `${draft.goal.replace(/[.\s]+$/, '')} через серию коротких практических мини-проектов`;
    demoOutcomeExample(draft);
  },
  outcomes: demoOutcomeExample,
  curriculum: (draft) => {
    const topic = draft.topics[0];
    if (topic)
      topic.content = `${topic.content.replace(/[.\s]+$/, '')}. В конце темы — разбор типичных ошибок на примерах учеников.`;
  },
  calendar: (draft) => {
    draft.requirements.calendar.description = `${draft.requirements.calendar.description.replace(/[.\s]+$/, '')}. Последняя неделя оставлена под защиту проектов.`;
  },
  materials: (draft) => {
    const activity = draft.activities[0];
    if (activity)
      activity.description = `${activity.description.replace(/[.\s]+$/, '')}. Перед выполнением — разбор образца решения.`;
  },
};
export class DemoCourseApi implements CourseApi {
  readonly mode = 'demo';
  private readonly contentSteps: ContentSteps;
  // Сервер подставляет шаги, вызывающие модель напрямую; браузер ходит к ним по HTTP.
  constructor(options: { contentSteps?: ContentSteps } = {}) {
    this.contentSteps = options.contentSteps ?? httpContentSteps;
  }
  private queue: Promise<unknown> = Promise.resolve();
  private transact<T>(work: (database: StoredDatabase) => Promise<T>): Promise<T> {
    const run = async () => {
      const db = load();
      const result = await work(db);
      save(db);
      return result;
    };
    const locked = async (): Promise<T> => {
      if (typeof navigator !== 'undefined' && navigator.locks)
        return await navigator.locks.request('courseos-demo-mutation', run);
      return await run();
    };
    const pending = this.queue.then(locked, locked);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  async list() {
    return this.transact(async (db) =>
      Object.entries(db.courses).map(([id, course]) => ({
        course_id: id,
        title: course.requirements.title,
        total_hours: course.requirements.total_hours,
        latest_version: latest(course)?.course_version || 0,
        status: course.job.status,
        template_id: course.requirements.template_id,
      })),
    );
  }
  async get(id: string, version?: number) {
    return this.transact(async (db) => {
      const course = db.courses[id];
      if (!course)
        throw new ApiError(404, 'Курс не найден. Проверьте адрес или создайте новый курс.');
      await advance(id, course, this.contentSteps);
      const snapshot = version
        ? course.snapshots.find((s) => s.course_version === version)
        : latest(course);
      if (version && !snapshot) throw new ApiError(404, 'Такая версия не найдена.');
      const current = snapshot ? structuredClone(snapshot) : null;
      if (current) {
        current.approvals = structuredClone(course.approvals);
        current.approval_applicable = approvalMatches(current);
        // Снимки, сохранённые до появления выгрузок, получают актуальный список файлов.
        withManifest(current);
      }
      return courseViewSchema.parse({
        course_id: id,
        snapshot: current,
        requirements: current?.skeleton.requirements ?? course.requirements,
        latest_version: latest(course)?.course_version || 0,
        versions: course.snapshots.map((s) => s.course_version),
        questions: [
          ...missingQuestions(course.requirements),
          ...unansweredContentQuestions(course.requirements),
        ],
        job: course.job,
        is_latest: !version || version === latest(course)?.course_version,
      });
    });
  }
  async getJob(id: string) {
    return this.transact(async (db) => {
      const entry = Object.entries(db.courses).find(([, c]) => c.job.id === id);
      if (!entry) throw new ApiError(404, 'Задача не найдена.');
      await advance(entry[0], entry[1], this.contentSteps);
      return structuredClone(entry[1].job);
    });
  }
  async command(envelope: CommandEnvelope): Promise<CommandResult> {
    return this.transact(async (db) => {
      const signature = canonicalJson(envelope);
      const prior = db.operations[envelope.request_id];
      if (prior) {
        if (prior.payload !== signature)
          throw new ApiError(409, 'Этот request_id уже использован с другим содержимым.');
        return structuredClone(prior.result);
      }
      const id = envelope.course_id || crypto.randomUUID();
      let course = db.courses[id];
      let plan: ChangePlan | null = null;
      if (envelope.action === 'start') {
        if (course) throw new ApiError(409, 'Курс уже существует.');
        const requirements = requirementsSchema.parse(envelope.payload);
        if (
          requirements.total_hours &&
          (new Decimal(requirements.total_hours).lt(16) ||
            new Decimal(requirements.total_hours).gt(500))
        )
          throw new ApiError(422, 'Объём должен быть от 16 до 500 часов.');
        const job = makeJob(id, 'start', envelope.request_id);
        if (
          missingQuestions(requirements).length ||
          unansweredContentQuestions(requirements).length
        ) {
          job.status = 'awaiting_clarification';
          job.next_action = 'Ответьте на вопросы агента';
        }
        course = { requirements, snapshots: [], approvals: [], plans: [], job };
        db.courses[id] = course;
      } else {
        if (!course) throw new ApiError(404, 'Курс не найден.');
        const base = latest(course);
        if (envelope.expected_version !== (base?.course_version || 0))
          throw new ApiError(
            409,
            'Версия устарела. Сохранённый черновик можно скопировать; обновите курс перед повтором.',
          );
        if (active(course.job) && !['cancel', 'record_observation'].includes(envelope.action))
          throw new ApiError(409, 'На курсе уже выполняется операция. Дождитесь её завершения.');
        switch (envelope.action) {
          case 'clarify': {
            const next = requirementsSchema.parse(envelope.payload);
            const answers = Object.fromEntries(
              unansweredContentQuestions(course.requirements).map((question) => [
                question.id,
                next.clarification_answers?.[question.id]?.trim() || '',
              ]),
            );
            const clarified = {
              ...course.requirements,
              clarification_answers: { ...course.requirements.clarification_answers, ...answers },
            };
            if (unansweredContentQuestions(clarified).length)
              throw new ApiError(422, 'Ответьте на все вопросы агента.');
            for (const question of missingQuestions(course.requirements))
              (course.requirements as Record<string, unknown>)[question.field] =
                next[question.field as keyof Requirements];
            if (!course.requirements.audience) course.requirements.audience = next.audience;
            if (!course.requirements.goal)
              course.requirements.goal =
                next.goal || `Освоить начальные действия по теме ${next.title}`;
            if (missingQuestions(course.requirements).length)
              throw new ApiError(422, 'Ответьте на все недостающие вопросы.');
            if (
              new Decimal(course.requirements.total_hours).lt(16) ||
              new Decimal(course.requirements.total_hours).gt(500)
            )
              throw new ApiError(422, 'Объём — от 16 до 500 часов.');
            if (contentQuestions(course.requirements).length)
              course.requirements.clarification_answers = clarified.clarification_answers;
            // Каркас своего запроса модель проектирует уже с ответами на вопросы.
            if (next.model_design) course.requirements.model_design = next.model_design;
            course.job = makeJob(id, 'clarify', envelope.request_id);
            break;
          }
          case 'save_skeleton': {
            if (!base) throw new ApiError(409, 'Программа ещё не создана.');
            const skeleton = refreshExplanations(skeletonSchema.parse(envelope.payload));
            skeleton.requirements.goal = skeleton.goal;
            const oldLimit = base.skeleton.requirements.calendar.daily_limit;
            if (
              oldLimit &&
              new Decimal(skeleton.requirements.calendar.daily_limit || 0).gt(oldLimit)
            )
              throw new ApiError(
                422,
                'Для повышения дневного лимита используйте явное решение в календаре.',
              );
            skeleton.requirements.original_limits = base.skeleton.requirements.original_limits;
            const previousStandards = base.skeleton.requirements.references.filter(
              isProfessionalStandardReference,
            );
            const nextStandards = skeleton.requirements.references.filter(
              isProfessionalStandardReference,
            );
            if (canonicalJson(previousStandards) !== canonicalJson(nextStandards)) {
              for (const outcome of skeleton.outcomes) outcome.professional_standard_code = null;
            }
            if (
              new Decimal(skeleton.requirements.total_hours).lt(16) ||
              new Decimal(skeleton.requirements.total_hours).gt(500)
            )
              throw new ApiError(422, 'Объём — от 16 до 500 часов.');
            if (canonicalJson(skeleton) === canonicalJson(base.skeleton)) break;
            course.requirements = skeleton.requirements;
            const snapshot = await newSnapshot(
              id,
              course,
              skeleton,
              base.materials.map((m) => ({ ...m, stale: true })),
              base,
            );
            course.snapshots.push(snapshot);
            course.job = makeJob(id, 'save_skeleton', envelope.request_id);
            course.job.status = 'awaiting_approval';
            course.job.next_action = 'Проверьте изменённые основания и утвердите новую версию';
            break;
          }
          case 'resolve_calendar': {
            if (!base) throw new ApiError(409, 'Программа ещё не создана.');
            await resolveCalendar(
              id,
              course,
              base,
              envelope.payload.option,
              envelope.payload.calendar,
            );
            break;
          }
          case 'apply_finding': {
            if (!base) throw new ApiError(409, 'Программа ещё не создана.');
            const issue = auditSnapshot(base).issues.find(
              (i) => i.id === envelope.payload.issue_id,
            );
            if (!issue?.fix)
              throw new ApiError(
                422,
                'Для этой находки нет предложения агента. Откройте место в программе.',
              );
            if (issue.fix === 'confirm_calendar') {
              const calendar = proposedCalendar(base.skeleton.requirements);
              if (!calendar) throw new ApiError(422, 'Укажите дату начала и срок обучения.');
              await resolveCalendar(id, course, base, 'confirm', calendar);
              break;
            }
            const skeleton = structuredClone(base.skeleton);
            const assessment = proposedAssessment(skeleton, issue.element_id);
            if (!assessment)
              throw new ApiError(422, 'Нет темы, в которую можно добавить средство.');
            skeleton.assessments.push(assessment);
            const topic = skeleton.topics.find((t) => t.id === assessment.topic_id)!;
            const label = assessmentLabels[assessment.type];
            topic.control = ['', '—'].includes(topic.control)
              ? label
              : `${topic.control} + ${label.toLowerCase()}`;
            refreshExplanations(skeleton);
            course.snapshots.push(
              await newSnapshot(
                id,
                course,
                skeleton,
                base.materials.map((m) => ({ ...m, stale: true })),
                base,
              ),
            );
            course.requirements = skeleton.requirements;
            course.job = makeJob(id, 'apply_finding', envelope.request_id);
            course.job.status = 'awaiting_approval';
            course.job.next_action = 'Предложение агента применено. Проверьте новую версию.';
            break;
          }
          case 'dismiss_finding': {
            if (!base) throw new ApiError(409, 'Программа ещё не создана.');
            const reason = envelope.payload.reason.trim();
            if (reason.length < 3)
              throw new ApiError(422, 'Укажите причину, по которой находка остаётся как есть.');
            const issue = auditSnapshot(base).issues.find(
              (i) => i.id === envelope.payload.issue_id,
            );
            if (!issue || !canAcceptException(issue))
              throw new ApiError(422, 'Эту проблему нельзя оставить как есть: её нужно исправить.');
            const snapshot = await newSnapshot(
              id,
              course,
              structuredClone(base.skeleton),
              structuredClone(base.materials),
              base,
            );
            snapshot.decisions = [
              ...snapshot.decisions.filter((d) => d.issue_id !== issue.id),
              {
                issue_id: issue.id,
                reason,
                actor: envelope.payload.actor ?? 'demo-methodist',
                at: now(),
                scope_hash: base.skeleton_hash,
                scope: `Версия ${base.skeleton_version}; элемент ${issue.element_id}`,
                finding: [issue.message, issue.expected, issue.actual, issue.evidence]
                  .filter(Boolean)
                  .join('\n'),
              },
            ];
            course.snapshots.push(finalize(snapshot));
            break;
          }
          case 'approve': {
            if (
              !base ||
              base.skeleton_version !== envelope.payload.skeleton_version ||
              base.skeleton_hash !== envelope.payload.skeleton_hash
            )
              throw new ApiError(409, 'Версия или hash не совпадают.');
            base.audit = auditSnapshot(base);
            if (base.audit.issues.some((i) => i.blocking))
              throw new ApiError(
                409,
                'Программа содержит блокирующие замечания. Утверждение запрещено.',
              );
            const priorApproval = course.approvals.find(
              (a) =>
                a.skeleton_hash === base.skeleton_hash &&
                a.skeleton_version === base.skeleton_version,
            );
            if (priorApproval) break;
            course.approvals.push({
              course_id: id,
              skeleton_version: base.skeleton_version,
              skeleton_hash: base.skeleton_hash,
              actor_id: envelope.payload.actor_id ?? 'demo-methodist',
              kind: envelope.payload.kind ?? 'human',
              approved_at: now(),
            });
            base.approvals = course.approvals;
            base.approval_applicable = approvalMatches(base);
            course.job = makeJob(id, 'generate', envelope.request_id);
            break;
          }
          case 'change_preview': {
            if (!base?.materials.length || !base.approval_applicable)
              throw new ApiError(
                409,
                'Сначала утвердите структуру программы и подготовьте материалы.',
              );
            const input = changeInputSchema.parse(envelope.payload);
            const elementEdit = isElementEdit(input) ? previewElementEdit(base, input) : null;
            const requires = elementEdit ? elementEdit.requiresApproval : true;
            const project =
              input.type === 'project' ? projectMaterial(base, input.target_id) : null;
            const affected = elementEdit
              ? base.materials.filter((m) => m.id === elementEdit.material.id)
              : input.type === 'project'
                ? base.materials.filter(
                    (m) =>
                      m.id === project!.id ||
                      m.topic_id === project!.topic_id ||
                      (project!.assessment_id !== null &&
                        m.assessment_id === project!.assessment_id),
                  )
                : input.type === 'topic'
                  ? affectedTopicMaterials(base, input.target_id)
                  : base.materials;
            if (!affected.length) throw new ApiError(422, 'Выберите существующий элемент.');
            plan = {
              id: crypto.randomUUID(),
              course_id: id,
              base_version: base.course_version,
              input,
              requires_approval: requires,
              affected: affected.map((m) => ({
                id: m.id,
                title: m.title,
                reason: elementEdit
                  ? 'Выбранный элемент → проверка → разделы программы → JSON и Markdown. Другие материалы сохраняются.'
                  : 'Материал зависит от изменяемого требования или темы',
                before: elementEdit ? elementEdit.before : m.content,
                after: elementEdit ? elementEdit.after : input.replacement,
                manual: m.manual,
              })),
              preserved_ids: base.materials.filter((m) => !affected.includes(m)).map((m) => m.id),
              cost: null,
            };
            course.plans.push(plan);
            break;
          }
          case 'change_apply': {
            if (!base) throw new ApiError(409, 'Версия не найдена.');
            plan = course.plans.find((p) => p.id === envelope.payload.change_id) || null;
            if (!plan || plan.base_version !== base.course_version)
              throw new ApiError(409, 'План правки устарел. Создайте новый preview.');
            if (plan.affected.some((a) => a.manual) && !envelope.payload.overwrite_manual)
              throw new ApiError(
                409,
                'Затронута ручная правка. Требуется отдельное согласие на перезапись.',
              );
            const skeleton = structuredClone(base.skeleton);
            const materials = structuredClone(base.materials);
            if (isElementEdit(plan.input)) {
              const edit = previewElementEdit(base, plan.input);
              edit.material.hash = await materialHash(edit.material);
              materials.splice(
                materials.findIndex((m) => m.id === edit.material.id),
                1,
                edit.material,
              );
              if (edit.requiresApproval) {
                skeleton.content_review = {
                  reason: plan.input.request,
                  affected_ids: [edit.material.id],
                  change_id: plan.id,
                };
                if (plan.input.type === 'assignment') {
                  const linked = new Set(
                    base.material_links
                      .filter((link) => link.material_id === edit.material.id)
                      .map((link) => link.assessment_id),
                  );
                  skeleton.assessments
                    .filter((a) => linked.has(a.id))
                    .forEach((a) => {
                      a.action = edit.material.expected;
                      a.criterion = edit.material.criteria.join('; ');
                    });
                  if (edit.material.topic_id === 'topic-final') {
                    const topic = skeleton.topics.find((t) => t.id === 'topic-final')!;
                    topic.content = `${edit.material.content}\nОжидаемый результат: ${edit.material.expected}\nКритерии: ${edit.material.criteria.join('; ')}`;
                  }
                }
              }
            } else {
              if (plan.input.type === 'hours') {
                const total = new Decimal(plan.input.replacement);
                if (total.lt(16) || total.gt(500))
                  throw new ApiError(422, 'Объём — от 16 до 500 часов.');
                skeleton.requirements.total_hours = total.toString();
                Object.assign(skeleton, makeSkeleton(skeleton.requirements, skeleton));
              } else if (plan.input.type === 'audience') {
                skeleton.requirements.audience = plan.input.replacement;
                Object.assign(skeleton, makeSkeleton(skeleton.requirements, skeleton));
              } else if (plan.input.type === 'topic') {
                const topic = skeleton.topics.find((t) => t.id === plan!.input.target_id);
                if (!topic) throw new ApiError(422, 'Тема не найдена.');
                topic.title = plan.input.replacement;
                topic.content = plan.input.replacement;
              } else {
                const project = projectMaterial(base, plan.input.target_id);
                skeleton.assessments
                  .filter((a) => a.id === project.assessment_id || a.topic_id === project.topic_id)
                  .forEach((a) => {
                    a.action = plan!.input.replacement;
                  });
                skeleton.requirements.constraints += `\n${plan.input.replacement}`;
              }
              refreshExplanations(skeleton);
              for (const material of materials.filter((m) =>
                plan!.affected.some((a) => a.id === m.id),
              )) {
                material.content = plan.input.replacement;
                material.manual = false;
                material.stale = true;
                material.hash = await materialHash(material);
              }
            }
            const snapshot = await newSnapshot(id, course, skeleton, materials, base);
            snapshot.changes = [
              ...base.changes,
              {
                id: plan.id,
                base_version: base.course_version,
                result_version: snapshot.course_version,
                request: plan.input.request,
                affected_ids: plan.affected.map((a) => a.id),
                preserved: plan.preserved_ids.map((id) => ({
                  id,
                  before_hash: base.materials.find((m) => m.id === id)!.hash,
                  after_hash: snapshot.materials.find((m) => m.id === id)!.hash,
                  equal:
                    base.materials.find((m) => m.id === id)!.hash ===
                    snapshot.materials.find((m) => m.id === id)!.hash,
                })),
              },
            ];
            course.snapshots.push(snapshot);
            course.requirements = skeleton.requirements;
            course.job = makeJob(id, 'change_apply', envelope.request_id);
            course.job.status = plan.requires_approval
              ? 'awaiting_approval'
              : snapshot.audit.technical_ready
                ? 'succeeded'
                : 'needs_review';
            course.job.next_action = plan.requires_approval
              ? 'Утвердите новую версию. Зависимые материалы ожидают обновления.'
              : 'Правка применена; сравните версии и повторный аудит';
            course.job.completed_at = now();
            break;
          }
          case 'manual_material': {
            if (!base) throw new ApiError(409, 'Материалы ещё не созданы.');
            const materials = structuredClone(base.materials);
            const material = materials.find((m) => m.id === envelope.payload.material_id);
            if (!material) throw new ApiError(422, 'Материал не найден.');
            material.content = envelope.payload.content;
            material.manual = true;
            material.hash = await materialHash(material);
            course.snapshots.push(
              await newSnapshot(id, course, structuredClone(base.skeleton), materials, base),
            );
            break;
          }
          case 'record_observation': {
            if (!base) throw new ApiError(409, 'Программа ещё не создана.');
            if (!envelope.payload.message.trim()) throw new ApiError(422, 'Укажите замечание.');
            const observation = {
              id: crypto.randomUUID(),
              severity: envelope.payload.blocking ? ('error' as const) : ('warning' as const),
              check_type: 'human' as const,
              element_id: envelope.payload.element_id,
              message: envelope.payload.message,
              expected: 'Основание проверено методистом',
              actual: 'Записано замечание; требуется решение',
              suggested_fix: 'Исправьте основание и утвердите новую версию.',
              blocking: envelope.payload.blocking,
            };
            const snapshot = await newSnapshot(
              id,
              course,
              structuredClone(base.skeleton),
              structuredClone(base.materials),
              base,
            );
            snapshot.observations.push(observation);
            finalize(snapshot);
            course.snapshots.push(snapshot);
            if (observation.blocking) {
              course.job.status = 'needs_review';
              course.job.next_action =
                'Исправьте блокирующее замечание. Существующий hash не разрешает продолжение.';
            }
            break;
          }
          case 'resolve_observation': {
            if (!base) throw new ApiError(409, 'Программа ещё не создана.');
            const issue = base.observations.find((i) => i.id === envelope.payload.issue_id);
            if (!issue || !envelope.payload.correction.trim())
              throw new ApiError(422, 'Укажите конкретное исправление основания.');
            const skeleton = structuredClone(base.skeleton);
            skeleton.requirements.constraints += `\nИсправление основания: ${envelope.payload.correction}`;
            refreshExplanations(skeleton);
            const snapshot = await newSnapshot(
              id,
              course,
              skeleton,
              base.materials.map((m) => ({ ...m, stale: true })),
              base,
            );
            snapshot.observations = snapshot.observations.filter((i) => i.id !== issue.id);
            finalize(snapshot);
            course.snapshots.push(snapshot);
            course.requirements = skeleton.requirements;
            course.job.status = 'awaiting_approval';
            course.job.next_action = 'Основание исправлено. Утвердите новую версию.';
            break;
          }
          case 'prune_history': {
            if (!base || !envelope.payload.archive_saved)
              throw new ApiError(422, 'Сначала скачайте архив истории.');
            const keep = new Set(envelope.payload.keep_versions);
            course.snapshots = course.snapshots.filter(
              (snapshot) =>
                snapshot.course_version === base.course_version ||
                keep.has(snapshot.course_version) ||
                course.approvals.some(
                  (approval) => approval.skeleton_hash === snapshot.skeleton_hash,
                ),
            );
            break;
          }
          case 'audit': {
            if (!base) throw new ApiError(409, 'Программа ещё не создана.');
            course.snapshots.push(
              await newSnapshot(
                id,
                course,
                structuredClone(base.skeleton),
                structuredClone(base.materials),
                base,
              ),
            );
            break;
          }
          case 'cancel':
            if (course.job.id !== envelope.payload.job_id)
              throw new ApiError(409, 'Задача изменилась.');
            course.job.status = 'cancelled';
            course.job.next_action = 'Результаты сохранены. Можно повторить незавершённый шаг.';
            course.job.completed_at = now();
            break;
          case 'retry':
            if (
              course.job.id !== envelope.payload.job_id ||
              !['cancelled', 'failed'].includes(course.job.status)
            )
              throw new ApiError(409, 'Повтор недоступен для текущего состояния.');
            course.job.status = 'queued';
            course.job.started_at = now();
            course.job.completed_at = null;
            course.job.attempt++;
            break;
        }
      }
      const result = { course_id: id, job: structuredClone(course.job), change_plan: plan };
      db.operations[envelope.request_id] = { payload: signature, result };
      return result;
    });
  }
  async getChange(id: string, changeId: string) {
    return this.transact(async (db) => {
      const plan = db.courses[id]?.plans.find((p) => p.id === changeId);
      if (!plan) throw new ApiError(404, 'План правки не найден.');
      return structuredClone(plan);
    });
  }
  async exportJson(id: string, version: number) {
    const view = await this.get(id, version);
    if (!view.snapshot) throw new ApiError(404, 'Snapshot ещё не создан.');
    const full = { ...courseJson(view.snapshot, now()), job: view.job };
    return new Blob([JSON.stringify(full, null, 2)], { type: 'application/json;charset=utf-8' });
  }
  async exportMarkdown(id: string, version: number): Promise<Blob> {
    const view = await this.get(id, version);
    if (
      !view.snapshot ||
      view.snapshot.course_id !== id ||
      view.snapshot.course_version !== version
    )
      throw new ApiError(409, 'Сервер не вернул выбранную сохранённую версию.');
    return new Blob([courseMarkdown(view.snapshot)], {
      type: 'text/markdown;charset=utf-8',
    });
  }
  async downloadFile(fileId: string): Promise<Blob> {
    const [format, courseId, version] = fileId.split(':');
    if (format === 'json') return this.exportJson(courseId, Number(version));
    if (format !== 'docx' && format !== 'pptx' && format !== 'lms')
      throw new ApiError(404, 'Файл этой версии не создан.');
    const view = await this.get(courseId, Number(version));
    if (!view.snapshot) throw new ApiError(404, 'Snapshot ещё не создан.');
    // Библиотеки DOCX и PPTX тяжёлые, поэтому загружаются только при скачивании.
    if (format === 'docx')
      return (await import('../export/program-docx')).buildProgramDocx(view.snapshot);
    if (format === 'lms')
      return new Blob([(await import('../export/lms-moodle')).buildMoodleXml(view.snapshot)], {
        type: 'application/xml;charset=utf-8',
      });
    return (await import('../export/lecture-pptx')).buildLecturePptx(view.snapshot);
  }
  async retrieveReference(_id: string, _url: string): Promise<Requirements['references'][number]> {
    throw new ApiError(
      503,
      'Содержимое URL не загружено. Получение и проверка ссылок требуют backend.',
    );
  }
  async uploadReference(_id: string, file: File): Promise<Requirements['references'][number]> {
    throw new ApiError(
      503,
      `«${file.name}»: реальное извлечение PDF/DOCX недоступно без backend. Для скана нужен текстовый референс; OCR не поддерживается. Вставьте текст.`,
    );
  }
  // В демо нет языковой модели. Однозначную замену «замени "А" на "Б"» выполняем
  // буквально, а на любой другой запрос показываем заготовленный пример правки
  // открытой вкладки, чтобы было видно, как выглядит сравнение и решение по полям.
  async proposeScopeEdit({ skeleton, scope, request }: ScopeEditRequest) {
    const draft = structuredClone(skeleton);
    const replace = request.match(/замени\S*\s+[«"](.+?)[»"]\s+на\s+[«"](.*?)[»"]/i);
    if (!replace) {
      demoScopeExample[scope](draft);
      return {
        skeleton: draft,
        note: 'Демо-пример: запрос не анализировался, правки заготовлены. Настоящий ИИ работает через backend.',
      };
    }
    const [, from, to] = replace;
    const swap = (text: string) => text.split(from).join(to);
    const edits: Record<EditScope, () => void> = {
      intent: () => {
        draft.goal = swap(draft.goal);
        draft.tasks = draft.tasks.map(swap);
        draft.requirements.audience = swap(draft.requirements.audience);
        draft.requirements.entry_level = swap(draft.requirements.entry_level);
        for (const outcome of draft.outcomes) outcome.description = swap(outcome.description);
      },
      outcomes: () => {
        for (const outcome of draft.outcomes) outcome.description = swap(outcome.description);
      },
      curriculum: () => {
        for (const topic of draft.topics) {
          topic.title = swap(topic.title);
          topic.content = swap(topic.content);
        }
        for (const activity of draft.activities) activity.description = swap(activity.description);
      },
      calendar: () => {
        draft.requirements.calendar.description = swap(draft.requirements.calendar.description);
      },
      materials: () => {
        for (const topic of draft.topics) {
          topic.title = swap(topic.title);
          topic.content = swap(topic.content);
        }
        for (const activity of draft.activities) activity.description = swap(activity.description);
        for (const assessment of draft.assessments) {
          assessment.action = swap(assessment.action);
          assessment.criterion = swap(assessment.criterion);
        }
      },
    };
    edits[scope]();
    if (canonicalJson(draft) === canonicalJson(skeleton))
      throw new ApiError(422, `На этой вкладке нет текста «${from}».`);
    return { skeleton: draft, note: `Заменено «${from}» на «${to}».` };
  }
  async delete(id: string) {
    await this.transact(async (db) => {
      if (!db.courses[id]) throw new ApiError(404, 'Курс не найден.');
      delete db.courses[id];
      for (const [key, operation] of Object.entries(db.operations))
        if (operation.result.course_id === id) delete db.operations[key];
    });
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith('courseos-') && key.includes(`-demo-${id}`)) localStorage.removeItem(key);
    }
  }
  async recordFeedback(input: FeedbackInput) {
    const entry: ResponseFeedback = {
      ...input,
      id: crypto.randomUUID(),
      mode: 'demo',
      created_at: now(),
      status: 'new',
      updated_at: null,
    };
    saveList(feedbackStorageKey, [...loadList(feedbackStorageKey, feedbackSchema), entry]);
    return entry;
  }
  async listFeedback() {
    return loadList(feedbackStorageKey, feedbackSchema);
  }
  async updateFeedback(id: string, patch: FeedbackPatch) {
    const entries = loadList(feedbackStorageKey, feedbackSchema);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new ApiError(404, 'Отзыв не найден.');
    entries[index] = feedbackSchema.parse({ ...entries[index], ...patch, updated_at: now() });
    saveList(feedbackStorageKey, entries);
    return entries[index];
  }
  async recordAiEditOutcome(input: AiEditOutcomeInput) {
    const outcome: AiEditOutcome = {
      ...input,
      id: crypto.randomUUID(),
      mode: 'demo',
      created_at: now(),
    };
    saveList(aiEditOutcomesStorageKey, [
      ...loadList(aiEditOutcomesStorageKey, aiEditOutcomeSchema),
      outcome,
    ]);
    return outcome;
  }
  async listAiEditOutcomes() {
    return loadList(aiEditOutcomesStorageKey, aiEditOutcomeSchema);
  }
  async reset() {
    await this.queue;
    const clear = () => {
      localStorage.removeItem(storageKey);
      localStorage.removeItem(feedbackStorageKey);
      localStorage.removeItem(aiEditOutcomesStorageKey);
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (
          key &&
          [
            'courseos-create-draft-demo',
            'courseos-pending-demo-',
            'courseos-skeleton-draft-demo-',
            'courseos-material-draft-demo-',
            'courseos-reference-draft-demo-',
            'courseos-change-draft-demo-',
          ].some((prefix) => key.startsWith(prefix))
        )
          localStorage.removeItem(key);
      }
    };
    if (typeof navigator !== 'undefined' && navigator.locks)
      await navigator.locks.request('courseos-demo-mutation', clear);
    else clear();
  }
}
