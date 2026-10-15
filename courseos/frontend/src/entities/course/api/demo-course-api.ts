import { skeletonRationaleMarkdown } from '../model/rationale';
import Decimal from 'decimal.js';
import { invalidateRationales } from '../model/rationale';
import { z } from 'zod';
import {
  requirementsSchema,
  skeletonSchema,
  snapshotSchema,
  courseViewSchema,
  changePlanSchema,
  jobSchema,
  type ChangePlan,
  type Job,
  type Requirements,
  type Skeleton,
  type Snapshot,
} from '../model/schema';
import { approvalMatches, auditSnapshot, calendarCalculation } from '../model/rules';
import {
  makeMaterials,
  makeSections,
  makeSkeleton,
  materialHash,
  missingQuestions,
  refreshExplanations,
} from '../model/factory';
import { contentHash, canonicalJson } from '../../../shared/lib/decimal';
import { ApiError } from '../../../shared/api/http';
import { withManifest, type CommandEnvelope, type CommandResult, type CourseApi } from './contract';
const storageKey = 'courseos-demo-v1';
interface StoredCourse {
  requirements: Requirements;
  snapshots: Snapshot[];
  job: Job;
  approvals: Snapshot['approvals'];
  plans: ChangePlan[];
}
interface StoredDatabase {
  courses: Record<string, StoredCourse>;
  operations: Record<string, { payload: string; result: CommandResult }>;
}
const databaseSchema = z.object({
  courses: z.record(
    z.string(),
    z.object({
      requirements: requirementsSchema,
      snapshots: z.array(snapshotSchema),
      job: jobSchema,
      approvals: z.array(snapshotSchema.shape.approvals.element),
      plans: z.array(changePlanSchema),
    }),
  ),
  operations: z.record(
    z.string(),
    z.object({
      payload: z.string(),
      result: z.object({
        course_id: z.string(),
        job: jobSchema,
        change_plan: changePlanSchema.nullable(),
      }),
    }),
  ),
});
function load(): StoredDatabase {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return { courses: {}, operations: {} };
  try {
    return databaseSchema.parse(JSON.parse(stored));
  } catch {
    throw new ApiError(
      422,
      'Сохранённые демоданные не соответствуют текущей схеме. Можно явно сбросить демоданные.',
    );
  }
}
function save(database: StoredDatabase) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(database));
  } catch {
    throw new ApiError(
      413,
      'Хранилище браузера заполнено. Экспортируйте данные и удалите ненужные демокурсы.',
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
    approvals: course.approvals,
    approval_applicable: false,
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
    const candidates = snapshot.materials.filter(
      (m) => m.type === a.type && a.outcome_ids.every((id) => m.outcome_ids.includes(id)),
    );
    const m = candidates.find((m) => m.topic_id === a.topic_id) || candidates[0];
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
async function advance(courseId: string, course: StoredCourse) {
  if (!active(course.job)) return;
  const elapsed = Date.now() - Date.parse(course.job.started_at);
  course.job.status = 'running';
  course.job.updated_at = now();
  if (course.job.operation === 'start' || course.job.operation === 'clarify') {
    if (elapsed < 400) return;
    const snapshot = await newSnapshot(courseId, course, makeSkeleton(course.requirements));
    course.snapshots.push(snapshot);
    course.job.steps = ['Параметры сохранены', 'Каркас и пять объяснений рассчитаны'];
    course.job.status = 'awaiting_approval';
    course.job.next_action = snapshot.skeleton.conflicts.some((c) => c.status === 'open')
      ? 'Разрешите конфликт, затем отдельно утвердите каркас'
      : 'Проверьте и утвердите каркас';
  } else {
    const base = latest(course)!;
    if (elapsed < 400) return;
    if (!base.approval_applicable) {
      course.job.status = 'failed';
      course.job.error = 'Нет применимого утверждения';
      course.job.next_action = 'Утвердите актуальную ревизию';
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
    const generated = await makeMaterials(base.skeleton);
    const preserved = base.materials.filter((m) => !m.stale);
    const materials = generated.map((m) => preserved.find((p) => p.id === m.id) || m);
    const applied = base.changes.at(-1);
    const plan = applied ? course.plans.find((p) => p.id === applied.id) : undefined;
    if (plan?.input.type === 'project') {
      for (const material of materials.filter((m) => plan.affected.some((a) => a.id === m.id))) {
        if (material.type === 'project' || material.type === 'seminar')
          material.content = `${plan.input.replacement}\nСохранить переменные, условия, циклы и утверждённые часы. Проверьте два сценария и выход из игры.`;
        if (material.type === 'working_program')
          material.content += `\nУточнённое требование к проекту: ${plan.input.replacement}`;
        material.hash = await materialHash(material);
      }
    }
    const completedIds = new Set(completed.map((topic) => topic.id));
    const savedIds = new Set(course.job.partial_materials.map((material) => material.id));
    course.job.partial_materials.push(
      ...materials.filter(
        (material) => completedIds.has(material.topic_id) && !savedIds.has(material.id),
      ),
    );
    if (elapsed < 1800) return;
    const snapshot = await newSnapshot(
      courseId,
      course,
      structuredClone(base.skeleton),
      materials,
      base,
    );
    course.snapshots.push(snapshot);
    course.job.status = snapshot.audit.technical_ready ? 'succeeded' : 'needs_review';
    course.job.steps.push('Аудит и полный JSON сохранены');
    course.job.next_action = 'Проверьте материалы и неподтверждённые источники';
    course.job.completed_at = now();
  }
}
export class DemoCourseApi implements CourseApi {
  readonly mode = 'demo';
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
      await advance(id, course);
      const snapshot = version
        ? course.snapshots.find((s) => s.course_version === version)
        : latest(course);
      if (version && !snapshot) throw new ApiError(404, 'Такая версия не найдена.');
      const current = snapshot ? structuredClone(snapshot) : null;
      if (current) {
        current.approvals = structuredClone(course.approvals);
        current.approval_applicable = approvalMatches(current);
      }
      return courseViewSchema.parse({
        course_id: id,
        snapshot: current,
        requirements: course.requirements,
        latest_version: latest(course)?.course_version || 0,
        versions: course.snapshots.map((s) => s.course_version),
        questions: missingQuestions(course.requirements),
        job: course.job,
        is_latest: !version || version === latest(course)?.course_version,
      });
    });
  }
  async getJob(id: string) {
    return this.transact(async (db) => {
      const entry = Object.entries(db.courses).find(([, c]) => c.job.id === id);
      if (!entry) throw new ApiError(404, 'Задача не найдена.');
      await advance(entry[0], entry[1]);
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
        if (missingQuestions(requirements).length) {
          job.status = 'awaiting_clarification';
          job.next_action = 'Ответьте только на недостающие вопросы';
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
            course.job = makeJob(id, 'clarify', envelope.request_id);
            break;
          }
          case 'save_skeleton': {
            if (!base) throw new ApiError(409, 'Каркас ещё не создан.');
            const skeleton = refreshExplanations(skeletonSchema.parse(envelope.payload));
            skeleton.requirements.goal = skeleton.goal;
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
            course.job.next_action = 'Проверьте изменённые основания и утвердите новую ревизию';
            break;
          }
          case 'resolve_calendar': {
            if (!base) throw new ApiError(409, 'Каркас ещё не создан.');
            const skeleton = structuredClone(base.skeleton);
            const before = canonicalJson(skeleton.requirements.calendar);
            skeleton.requirements.calendar = envelope.payload.calendar;
            let calc = calendarCalculation(skeleton.requirements);
            if (envelope.payload.option !== 'confirm' && new Decimal(calc.deficit).eq(0))
              throw new ApiError(
                422,
                'Часов достаточно: изменение для устранения нехватки не требуется.',
              );
            if (envelope.payload.option === 'extend') {
              while (calc.needed !== null && calc.days < calc.needed) {
                skeleton.requirements.calendar.calendar_days++;
                calc = calendarCalculation(skeleton.requirements);
              }
            }
            if (envelope.payload.option === 'raise') {
              if (!calc.minimumLimit) throw new ApiError(422, 'Укажите доступные учебные дни.');
              skeleton.requirements.calendar.daily_limit = calc.minimumLimit;
              skeleton.requirements.constraints += `\nРешение методиста: исходный дневной лимит изменён на ${calc.minimumLimit} ч/день.`;
            }
            if (envelope.payload.option === 'reduce') {
              if (new Decimal(calc.capacity).lt(16))
                throw new ApiError(422, 'Вместимость меньше минимальных 16 часов.');
              skeleton.requirements.total_hours = calc.capacity;
              skeleton.requirements.constraints += `\nРешение методиста: вместо исходного объёма принят ${calc.capacity} ч; глубина результатов пересматривается до базовых действий по образцу.`;
            }
            skeleton.requirements.calendar.description = `${skeleton.requirements.calendar.calendar_days} календарных / ${calendarCalculation(skeleton.requirements).days} учебных дней, до ${skeleton.requirements.calendar.daily_limit} ч/день; ${skeleton.requirements.calendar.weekdays_only ? 'по будням' : 'ежедневно'}. Подтверждено методистом.`;
            const revised =
              envelope.payload.option === 'reduce'
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
                option_id: envelope.payload.option,
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
              'Решение сохранено. Отдельно утвердите каркас после повторного расчёта.';
            break;
          }
          case 'approve': {
            if (
              !base ||
              base.skeleton_version !== envelope.payload.skeleton_version ||
              base.skeleton_hash !== envelope.payload.skeleton_hash
            )
              throw new ApiError(409, 'Ревизия или hash не совпадают.');
            base.audit = auditSnapshot(base);
            if (base.audit.issues.some((i) => i.blocking))
              throw new ApiError(
                409,
                'Каркас содержит блокирующие замечания. Утверждение запрещено.',
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
              actor_id: 'demo-methodist',
              approved_at: now(),
            });
            base.approvals = course.approvals;
            base.approval_applicable = approvalMatches(base);
            course.job = makeJob(id, 'generate', envelope.request_id);
            break;
          }
          case 'change_preview': {
            if (!base?.materials.length || !base.approval_applicable)
              throw new ApiError(409, 'Сначала утвердите каркас и подготовьте материалы.');
            const input = envelope.payload;
            const requires = input.type !== 'question';
            const affected =
              input.type === 'question'
                ? base.materials.filter((m) => m.questions.some((q) => q.id === input.target_id))
                : input.type === 'project'
                  ? base.materials.filter(
                      (m) => m.id === 'project-final' || m.topic_id === 'topic-7',
                    )
                  : input.type === 'topic'
                    ? base.materials.filter((m) => m.topic_id === input.target_id)
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
                reason:
                  input.type === 'question'
                    ? 'Вопрос → ключ → объяснение → аудит → JSON и банк тестов; соседние темы сохраняются'
                    : 'Материал зависит от изменяемого требования или темы',
                before:
                  input.type === 'question'
                    ? m.questions.find((q) => q.id === input.target_id)!.text
                    : m.content,
                after: input.replacement,
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
            if (plan.input.type === 'question') {
              const material = materials.find((m) =>
                m.questions.some((q) => q.id === plan!.input.target_id),
              )!;
              const question = material.questions.find((q) => q.id === plan!.input.target_id)!;
              question.text = plan.input.replacement;
              question.correct_index = plan.input.correct_index ?? question.correct_index;
              question.explanation = plan.input.explanation || question.explanation;
              if (question.correct_index < 0 || question.correct_index >= question.options.length)
                throw new ApiError(422, 'Ключ выходит за пределы вариантов.');
              material.hash = await materialHash(material);
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
                skeleton.assessments
                  .filter((a) => a.topic_id === 'topic-final')
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
              ? 'Утвердите новую ревизию. Зависимые материалы ожидают обновления.'
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
            if (!base) throw new ApiError(409, 'Каркас ещё не создан.');
            if (!envelope.payload.message.trim()) throw new ApiError(422, 'Укажите замечание.');
            const observation = {
              id: crypto.randomUUID(),
              severity: envelope.payload.blocking ? ('error' as const) : ('warning' as const),
              check_type: 'human' as const,
              element_id: envelope.payload.element_id,
              message: envelope.payload.message,
              expected: 'Основание проверено методистом',
              actual: 'Записано замечание; требуется решение',
              suggested_fix: 'Исправьте основание и утвердите новую ревизию.',
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
            if (!base) throw new ApiError(409, 'Каркас ещё не создан.');
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
            course.job.next_action = 'Основание исправлено. Утвердите новую ревизию.';
            break;
          }
          case 'audit': {
            if (!base) throw new ApiError(409, 'Каркас ещё не создан.');
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
    const full = {
      ...view.snapshot,
      exported_at: now(),
      notice: 'Демонстрационные данные. Черновик — требует проверки методистом.',
      job: view.job,
      known_issues: view.snapshot.audit.issues,
    };
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
    return new Blob([skeletonRationaleMarkdown(view.snapshot)], {
      type: 'text/markdown;charset=utf-8',
    });
  }
  async downloadFile(_id: string): Promise<Blob> {
    throw new ApiError(404, 'Файл этой версии не создан. Подключите серверный экспортёр.');
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
  async reset() {
    await this.queue;
    const clear = () => {
      localStorage.removeItem(storageKey);
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
