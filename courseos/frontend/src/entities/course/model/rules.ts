import Decimal from 'decimal.js';
import {
  skeletonElements,
  rationaleCoverage,
  currentRationales,
  sourceById,
  rationaleIsSupported,
  rationaleSignature,
} from './rationale';
import type { Audit, Requirements, Skeleton, Snapshot } from './schema';
import { hourKinds, sumHours } from '../../../shared/lib/decimal';
export function calendarCalculation(requirements: Requirements) {
  const calendar = requirements.calendar;
  const start = new Date(`${calendar.start || '2026-10-14'}T00:00:00Z`);
  let days = 0;
  for (let i = 0; i < calendar.calendar_days; i++) {
    const date = new Date(start.getTime() + i * 86400000);
    if (!calendar.weekdays_only || (date.getUTCDay() !== 0 && date.getUTCDay() !== 6)) days++;
  }
  const total = new Decimal(requirements.total_hours || 0);
  const limit = new Decimal(calendar.daily_limit || 0);
  const capacity = limit.times(days);
  return {
    days,
    needed: limit.gt(0) ? total.div(limit).ceil().toNumber() : null,
    capacity: capacity.toString(),
    deficit: Decimal.max(total.minus(capacity), 0).toString(),
    minimumLimit: days ? total.div(days).toFixed(6, Decimal.ROUND_UP) : null,
  };
}
export function calendarSummary(requirements: Requirements) {
  const calc = calendarCalculation(requirements);
  const calendar = requirements.calendar;
  const hasDates =
    !!calendar.start && !Number.isNaN(Date.parse(calendar.start)) && calendar.calendar_days > 0;
  return [
    calc.needed === null
      ? 'Укажите максимум часов в день, чтобы рассчитать нужное число учебных дней.'
      : `Нужно ${calc.needed} учебных дней.`,
    hasDates
      ? `Доступно ${calc.days} учебных дней.`
      : 'Укажите дату начала и длительность, чтобы рассчитать доступные учебные дни.',
    hasDates && calc.needed !== null ? `Вместимость — ${calc.capacity} ч.` : '',
    !calendar.same_units ? 'Уточните единицы часов объёма и дневной нагрузки.' : '',
    !calendar.confirmed ? 'Расчёт предварительный: календарь ещё не подтверждён.' : '',
  ]
    .filter(Boolean)
    .join(' ');
}
export function hourTotals(skeleton: Skeleton) {
  return Object.fromEntries(
    hourKinds.map((kind) => [kind, sumHours(skeleton.topics.map((topic) => topic.hours[kind]))]),
  ) as Record<(typeof hourKinds)[number], string>;
}
export function auditSnapshot(snapshot: Snapshot): Audit {
  const skeleton = snapshot.skeleton;
  const issues: Audit['issues'] = structuredClone(snapshot.observations || []);
  const actual = sumHours(skeleton.topics.flatMap((topic) => Object.values(topic.hours)));
  const badTopics = skeleton.topics.filter(
    (topic) => !new Decimal(sumHours(Object.values(topic.hours))).eq(topic.planned_total),
  );
  const balance = new Decimal(actual).eq(skeleton.requirements.total_hours) && !badTopics.length;
  badTopics.forEach((topic) =>
    issues.push({
      id: `hours-${topic.id}`,
      severity: 'error',
      check_type: 'rule',
      element_id: topic.id,
      message: `Часы темы «${topic.title}» не совпадают с её заявленным объёмом`,
      expected: topic.planned_total,
      actual: sumHours(Object.values(topic.hours)),
      suggested_fix: 'Откройте эту тему в редакторе; согласуйте заявленный объём и виды работы.',
      blocking: true,
    }),
  );
  if (!new Decimal(actual).eq(skeleton.requirements.total_hours))
    issues.push({
      id: 'audit-hours',
      severity: 'error',
      check_type: 'rule',
      element_id: skeleton.topics[0]?.id || 'requirements',
      message: 'Сумма часов тем не совпадает с объёмом курса',
      expected: skeleton.requirements.total_hours,
      actual,
      suggested_fix: 'Исправьте часы в учебном плане и сохраните новую ревизию.',
      blocking: true,
    });
  const gaps = skeleton.outcomes.filter(
    (outcome) =>
      !skeleton.topics.some((topic) => topic.outcome_ids.includes(outcome.id)) ||
      !skeleton.activities.some((activity) => activity.outcome_ids.includes(outcome.id)) ||
      new Set(
        skeleton.assessments
          .filter((item) => item.outcome_ids.includes(outcome.id))
          .map((item) => item.type),
      ).size < 2,
  );
  gaps.forEach((outcome) =>
    issues.push({
      id: `audit-${outcome.id}`,
      severity: 'error',
      check_type: 'rule',
      element_id: outcome.id,
      message: `Результат «${outcome.description}» не имеет двух разных оценочных средств`,
      expected: 'Тема, активность и два разных средства',
      actual: 'Неполное покрытие',
      suggested_fix: 'Добавьте средство и наблюдаемый критерий в редакторе программы.',
      blocking: true,
    }),
  );
  skeleton.conflicts
    .filter((conflict) => conflict.status === 'open')
    .forEach((conflict) =>
      issues.push({
        id: conflict.id,
        severity: 'error',
        check_type: 'rule',
        element_id: 'calendar',
        message: conflict.expected,
        expected: conflict.expected,
        actual: conflict.actual,
        suggested_fix: 'Уточните календарь и сохраните решение методиста.',
        blocking: true,
      }),
    );
  const badKeys = snapshot.materials.flatMap((material) =>
    material.questions
      .filter(
        (question) =>
          question.correct_index < 0 || question.correct_index >= question.options.length,
      )
      .map((question) => ({ material, question })),
  );
  badKeys.forEach(({ material, question }) =>
    issues.push({
      id: `key-${question.id}`,
      severity: 'error',
      check_type: 'rule',
      element_id: material.id,
      message: 'Ключ вопроса не соответствует вариантам',
      expected: 'Существующий вариант',
      actual: String(question.correct_index),
      suggested_fix: 'Согласуйте исправление ключа.',
      blocking: true,
    }),
  );
  snapshot.sources
    .filter(
      (source) =>
        source.provenance?.access !== 'read' || source.provenance?.content !== 'confirmed',
    )
    .forEach((source) =>
      issues.push({
        id: `source-${source.id}`,
        severity: 'warning',
        check_type: 'rule',
        element_id: source.id,
        message: `Источник «${source.name}» требует проверки применимости`,
        expected: 'Поддерживает конкретное утверждение',
        actual: source.status,
        suggested_fix: 'Откройте исходный фрагмент; подтвердите область проверки после вычитки.',
        blocking: false,
      }),
    );
  if (skeleton.requirements.template_id === 'acr_professional')
    issues.push({
      id: 'legal-review',
      severity: 'warning',
      check_type: 'human',
      element_id: 'legal',
      message: 'Нормативная опора и коды профстандарта не подтверждены',
      expected: 'Первичный документ и проверенная применимость',
      actual: 'Не проверено; расхождение №499/№266 описано в брифе',
      suggested_fix: 'Согласуйте нормативную основу с кейсодателем; коды не заполнены.',
      blocking: false,
    });
  const materialComplete =
    snapshot.materials.length > 0 &&
    snapshot.materials.every(
      (material) =>
        !material.stale &&
        material.content.trim() &&
        (material.type === 'lecture' ? material.slides.length > 0 : true),
    );
  const ids = [
    ...skeleton.topics.map((t) => t.id),
    ...skeleton.outcomes.map((o) => o.id),
    ...skeleton.activities.map((a) => a.id),
    ...skeleton.assessments.map((a) => a.id),
    ...snapshot.materials.map((m) => m.id),
    ...snapshot.sources.map((s) => s.id),
    ...snapshot.sources.map((s) => `${s.id}-chunk`),
  ];
  const topicIds = new Set(skeleton.topics.map((t) => t.id));
  const outcomeIds = new Set(skeleton.outcomes.map((o) => o.id));
  const linkValid =
    snapshot.edges.every((edge) => ids.includes(edge.from_id) && ids.includes(edge.to_id)) &&
    skeleton.topics.every(
      (t) =>
        t.prerequisite_ids.every((id) => topicIds.has(id)) &&
        t.outcome_ids.every((id) => outcomeIds.has(id)),
    ) &&
    [...skeleton.activities, ...skeleton.assessments].every(
      (a) => topicIds.has(a.topic_id) && a.outcome_ids.every((id) => outcomeIds.has(id)),
    ) &&
    skeleton.assessments.every((a) => a.action.trim() && a.criterion.trim()) &&
    (skeleton.dependency_reasons || []).every(
      (d) =>
        topicIds.has(d.from_id) &&
        skeleton.topics.find((t) => t.id === d.to_id)?.prerequisite_ids.includes(d.from_id),
    );
  const elements = skeletonElements(skeleton);
  const elementIds = new Set(elements.map((e) => e.id));
  const brokenBasis = (skeleton.rationales || []).filter(
    (r) =>
      !elementIds.has(r.element_id) ||
      r.related_ids.some((id) => !elementIds.has(id)) ||
      (!!r.source_id && r.source_id !== 'request' && !sourceById(skeleton, r.source_id)),
  );
  if (brokenBasis.length)
    issues.push({
      id: 'broken-rationale',
      severity: 'error',
      check_type: 'rule',
      element_id: brokenBasis[0].element_id,
      message: 'Основание указывает на отсутствующий элемент или источник',
      expected: 'Целые ссылки оснований',
      actual: brokenBasis.map((r) => r.id).join(', '),
      suggested_fix:
        'Исправьте связь или восстановите источник; прежний фрагмент сохранён в версии.',
      blocking: true,
    });
  const coverage = rationaleCoverage(skeleton);
  const inputSignature = rationaleSignature(skeleton);
  if (coverage.assumptions + coverage.gaps)
    issues.push({
      id: 'rationale-review',
      severity: 'warning',
      check_type: 'human',
      element_id: 'goal',
      message: 'Основания каркаса требуют содержательной проверки',
      expected: 'Проверка применимости к аудитории, заданиям и времени',
      actual: `Допущения: ${coverage.assumptions}; пробелы/устаревшие: ${coverage.gaps}`,
      suggested_fix:
        'Откройте основания элементов; проверьте каждое решение и сохраните проверку в новой версии.',
      blocking: false,
    });
  const badClaims = elements
    .flatMap((e) => currentRationales(skeleton, e.id, inputSignature))
    .filter(
      (r) =>
        ['confirmed', 'expert_checked', 'pilot_checked'].includes(r.status) &&
        !rationaleIsSupported(skeleton, r, inputSignature),
    );
  if (badClaims.length)
    issues.push({
      id: 'unsupported-claim',
      severity: 'warning',
      check_type: 'human',
      element_id: badClaims[0].element_id,
      message: 'Заявленный статус основания не подтверждён данными',
      expected: 'Прочитанный источник, фрагмент и проверенная применимость',
      actual: badClaims.map((r) => r.id).join(', '),
      suggested_fix:
        'Проверьте фрагмент, доступ к документу и применимость; регистрация URL недостаточна.',
      blocking: false,
    });
  const budgetErrors = (skeleton.time_budgets || []).filter((b) => {
    const topic = skeleton.topics.find((t) => t.id === b.topic_id);
    return (
      !topic ||
      !new Decimal(
        sumHours([b.explanation, b.supported_practice, b.independent, b.feedback, b.assessment]),
      ).eq(topic.planned_total)
    );
  });
  if (budgetErrors.length)
    issues.push({
      id: 'time-actions',
      severity: 'warning',
      check_type: 'rule',
      element_id: budgetErrors[0].topic_id,
      message: 'После правки часов состав учебных действий требует пересмотра',
      expected: 'Непересекающиеся действия в объёме темы',
      actual: budgetErrors.map((b) => b.topic_id).join(', '),
      suggested_fix: 'Пересмотрите оценки действий; прежний расчёт не подтверждает новые часы.',
      blocking: false,
    });
  const calc = calendarCalculation(skeleton.requirements);
  const c = skeleton.requirements.calendar;
  const calendarValid =
    c.confirmed &&
    c.same_units &&
    !!c.start &&
    !Number.isNaN(Date.parse(c.start)) &&
    c.calendar_days > 0 &&
    !!c.daily_limit &&
    Number(c.daily_limit) > 0 &&
    new Decimal(calc.deficit).eq(0);
  if (!calendarValid && !skeleton.conflicts.some((c) => c.status === 'open'))
    issues.push({
      id: 'calendar-independent',
      severity: 'error',
      check_type: 'rule',
      element_id: 'calendar',
      message: 'Календарь не подтверждён или не вмещает объём',
      expected: 'Подтверждённые единицы, даты и вместимость',
      actual: calendarSummary(skeleton.requirements),
      suggested_fix: 'Уточните календарь и сохраните решение.',
      blocking: true,
    });
  const duplicateIds = new Set(ids).size !== ids.length;
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const topic = skeleton.topics.find((topic) => topic.id === id);
    const cycle = topic?.prerequisite_ids.some(hasCycle) || false;
    visiting.delete(id);
    visited.add(id);
    return cycle;
  };
  const cycle = skeleton.topics.some((topic) => hasCycle(topic.id));
  if (duplicateIds || cycle)
    issues.push({
      id: 'invalid-structure',
      severity: 'error',
      check_type: 'rule',
      element_id: 'map',
      message: duplicateIds
        ? 'Идентификаторы элементов повторяются'
        : 'Порядок тем содержит цикл предпосылок',
      expected: 'Уникальные ID и порядок без циклов',
      actual: 'Структурное нарушение',
      suggested_fix: 'Проверьте связи и порядок тем.',
      blocking: true,
    });
  if (!linkValid)
    issues.push({
      id: 'broken-link',
      severity: 'error',
      check_type: 'rule',
      element_id: 'map',
      message: 'Связь указывает на отсутствующий элемент',
      expected: 'Все ID существуют',
      actual: 'Разорванная ссылка',
      suggested_fix: 'Проверьте карту связей.',
      blocking: true,
    });
  const checks: Audit['checks'] = [
    {
      id: 'rationale-coverage',
      title: 'Покрытие элементов основаниями',
      status: coverage.gaps ? 'failed' : 'passed',
      expected: `${elements.length} элементов`,
      actual: `Подтверждено ${coverage.confirmed}; эксперт/пилот ${coverage.expert}; допущения ${coverage.assumptions}; пробелы ${coverage.gaps}. Наличие записи не доказывает её содержание.`,
    },
    {
      id: 'pedagogy',
      title: 'Педагогическая достаточность и смысл связей',
      status: 'not_run',
      expected: 'Независимая предметная экспертиза и пилот',
      actual: 'Не удалось оценить автоматически; часы и целые связи не подтверждают достижимость.',
    },
    {
      id: 'prerequisites',
      title: 'Структура графа предпосылок',
      status: cycle || !linkValid || duplicateIds ? 'failed' : 'passed',
      expected: 'Целые ID, отсутствие циклов',
      actual: 'Проверена только структура. Содержательная корректность не оценена.',
    },
    {
      id: 'time-actions',
      title: 'Суммы учебных действий',
      status: !skeleton.time_budgets ? 'not_run' : budgetErrors.length ? 'failed' : 'passed',
      expected: 'Один учёт каждого действия',
      actual: `Несогласованных оценок: ${budgetErrors.length}; достаточность времени не проверена.`,
    },
    {
      id: 'hours',
      title: 'Баланс часов',
      status: balance ? 'passed' : 'failed',
      expected: `${skeleton.requirements.total_hours} ч`,
      actual: `${actual} ч; аттестация включена один раз`,
    },
    {
      id: 'coverage',
      title: 'Покрытие результатов — условие кейса',
      status: gaps.length || !linkValid ? 'failed' : 'passed',
      expected: `${skeleton.outcomes.length} результатов × минимум 2 средства`,
      actual: `${skeleton.outcomes.length - gaps.length} покрыто; ссылки ${linkValid ? 'целы' : 'нарушены'}`,
    },
    {
      id: 'calendar',
      title: 'Календарь и ограничения',
      status:
        !calendarValid || skeleton.conflicts.some((c) => c.status === 'open') ? 'failed' : 'passed',
      expected: 'Подтверждённый календарь',
      actual: skeleton.requirements.calendar.description,
    },
    {
      id: 'sections',
      title: 'Полнота разделов и материалов',
      status: materialComplete && snapshot.sections.length > 0 ? 'passed' : 'not_run',
      expected: 'Все применимые разделы выбранного образца',
      actual: materialComplete
        ? `${snapshot.sections.length} разделов, ${snapshot.materials.length} материалов`
        : 'Содержание ещё не создано или ожидает обновления',
    },
    {
      id: 'keys',
      title: 'Ключи и критерии',
      status: !snapshot.materials.length ? 'not_run' : badKeys.length ? 'failed' : 'passed',
      expected: 'Ключи в пределах вариантов; критерии заполнены',
      actual: `${badKeys.length} ошибок ключей`,
    },
    {
      id: 'sources',
      title: 'Достоверность источников',
      status: 'not_run',
      expected: 'Предметная и нормативная проверка',
      actual: 'Техническая регистрация выполнена; содержательная проверка не проведена',
    },
  ];
  return {
    course_version: snapshot.course_version,
    at: new Date().toISOString(),
    checks,
    issues,
    technical_ready: materialComplete && !issues.some((issue) => issue.blocking),
    expert_status: 'not_reviewed',
  };
}
export function approvalMatches(snapshot: Snapshot): boolean {
  return (
    snapshot.approvals.some(
      (a) =>
        a.course_id === snapshot.course_id &&
        a.skeleton_version === snapshot.skeleton_version &&
        a.skeleton_hash === snapshot.skeleton_hash,
    ) && !snapshot.audit.issues.some((issue) => issue.blocking)
  );
}
