import { clarificationReason } from './demo-clarifications';
import type { Rationale, Skeleton, Snapshot, Requirements } from './schema';
import { canonicalJson, sumHours } from '../../../shared/lib/decimal';

export const missingBasis = 'Основание не найдено; требуется проверка';
export type SkeletonElement = { id: string; title: string; decision: string; related: string[] };
// Virtual IDs are deterministic and remain stable when an existing item is edited.
export function skeletonElements(s: Skeleton): SkeletonElement[] {
  const item = (id: string, title: string, decision: string, related: string[] = []) => ({
    id,
    title,
    decision,
    related,
  });
  return [
    item(
      'goal',
      'Цель',
      s.goal,
      s.outcomes.map((o) => o.id),
    ),
    item('audience', 'Аудитория', s.requirements.audience),
    item('entry_level', 'Входной уровень', s.requirements.entry_level),
    ...s.tasks.map((t, i) =>
      item(
        `task-${i + 1}`,
        'Задача',
        t,
        s.outcomes.map((o) => o.id),
      ),
    ),
    ...s.outcomes.map((o) =>
      item(
        o.id,
        'Результат обучения',
        `${o.description}. Предпосылка: ${o.prerequisite}. Глубина: ${o.depth}`,
        s.assessments.filter((a) => a.outcome_ids.includes(o.id)).map((a) => a.id),
      ),
    ),
    ...[...new Set(s.topics.map((t) => t.module_id))].map((id) =>
      item(
        id,
        'Модуль',
        s.topics
          .filter((t) => t.module_id === id)
          .map((t) => t.title)
          .join('; '),
        s.topics.filter((t) => t.module_id === id).map((t) => t.id),
      ),
    ),
    ...s.topics.flatMap((t) => [
      item(
        t.id,
        t.title,
        `${t.content} Форма: ${t.delivery}. Контроль: ${t.control}`,
        t.outcome_ids,
      ),
      item(
        `hours:${t.id}`,
        `Часы: ${t.title}`,
        `${t.planned_total} ч; ${Object.entries(t.hours)
          .map(([k, v]) => `${k}=${v}`)
          .join(
            ', ',
          )}. Состав действий: ${canonicalJson(s.time_budgets?.find((b) => b.topic_id === t.id) || null)}`,
        [t.id],
      ),
      ...t.prerequisite_ids.map((from) =>
        item(
          `dependency:${from}:${t.id}`,
          'Предпосылка',
          s.dependency_reasons?.find((d) => d.from_id === from && d.to_id === t.id)?.action ||
            missingBasis,
          [from, t.id],
        ),
      ),
    ]),
    ...s.activities.map((a) =>
      item(a.id, 'Учебная активность', a.description, [a.topic_id, ...a.outcome_ids]),
    ),
    ...s.assessments.flatMap((a) => [
      item(a.id, `Оценочное средство: ${a.type}`, a.action, [a.topic_id, ...a.outcome_ids]),
      item(`criterion:${a.id}`, 'Критерий', a.criterion, [a.id, ...a.outcome_ids]),
    ]),
    item(
      'hours',
      'Объём курса',
      `${s.requirements.total_hours} ч; сумма тем ${sumHours(s.topics.map((t) => t.planned_total))}`,
      s.topics.map((t) => `hours:${t.id}`),
    ),
    item('calendar', 'Календарь', canonicalJson(s.requirements.calendar), ['hours']),
    item('constraints', 'Ограничения', s.requirements.constraints),
    ...s.conflicts.map((c) =>
      item(
        c.id,
        'Противоречие и решение',
        `${c.expected}; ${c.actual}; ${c.calculation}; решение: ${canonicalJson(c.decision)}; варианты: ${c.options.map((o) => `${o.title}: ${o.consequence}`).join('; ')}`,
        ['calendar', 'hours'],
      ),
    ),
  ];
}
export function rationaleSignature(s: Skeleton) {
  const value = canonicalJson({
    requirements: s.requirements,
    goal: s.goal,
    tasks: s.tasks,
    outcomes: s.outcomes,
    topics: s.topics,
    activities: s.activities,
    assessments: s.assessments,
    conflicts: s.conflicts,
    time_budgets: s.time_budgets,
    dependency_reasons: s.dependency_reasons,
    rationale_sources: s.rationale_sources,
  });
  // A compact deterministic cache signature, not an integrity/security hash.
  // Snapshot integrity is separately identified by SHA-256.
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ value.charCodeAt(i);
  }
  return `inputs-v1:${value.length}:${a >>> 0}:${b >>> 0}`;
}
export function currentRationales(
  s: Skeleton,
  id: string,
  signature = rationaleSignature(s),
): Rationale[] {
  return (s.rationales || [])
    .filter((r) => r.element_id === id)
    .map((r) => (r.input_signature === signature ? r : { ...r, status: 'stale' }));
}
export function initializeRationales(s: Skeleton) {
  const signature = rationaleSignature(s);
  s.rationales = skeletonElements(s).map((e) => {
    const field = (
      {
        goal: 'goal',
        audience: 'audience',
        entry_level: 'entry_level',
        constraints: 'constraints',
        hours: 'total_hours',
      } as Record<string, keyof Requirements>
    )[e.id];
    const requestValue = field ? String(s.requirements[field]) : '';
    const clarification = clarificationReason(s.requirements, Number(e.id.replace(/^topic-/, '')));
    const confirmed = !!requestValue && (e.id !== 'goal' || requestValue === s.goal);
    return {
      id: `rationale:${e.id}`,
      element_id: e.id,
      version: 1,
      decision: e.decision,
      purpose: `${clarification ? `${clarification} ` : ''}Для аудитории «${s.requirements.audience}». Связанные элементы: ${e.related.join(', ') || 'вводные курса'}. ${confirmed ? 'Сохранено условие запроса.' : 'Предложение демонстрационного проектировщика; необходимость требует предметной проверки.'}`,
      related_ids: e.related,
      kind: confirmed ? 'request' : 'assumption',
      source_id: confirmed ? 'request' : null,
      fragment: confirmed ? requestValue : '',
      coordinate: confirmed ? `requirements.${field}` : '',
      applicability: confirmed
        ? 'Подтверждает формулировку запроса, но не достижимость.'
        : missingBasis,
      alternatives: confirmed
        ? 'Изменение требует решения заказчика.'
        : 'Альтернативы не сравнивались; предложить сокращение глубины, другую практику или больше времени.',
      trust: confirmed
        ? 'Прямой структурированный ввод; внешняя достоверность и входные умения не проверены.'
        : 'Эксперт и пилот отсутствуют.',
      limitations:
        'Исследование общего подхода не подтверждает конкретные часы, порядок и достижимость для этой аудитории.',
      status: confirmed ? 'confirmed' : 'unverified',
      verification: confirmed
        ? 'Совпадение с полем запроса.'
        : 'Предварительное допущение; экспертная оценка и пилот не проводились.',
      next_check: confirmed
        ? 'Уточнить вводные с заказчиком и проверить входной уровень.'
        : 'Предметный эксперт: проверить необходимость, альтернативы, задания и длительности; затем пилот с целевой аудиторией.',
      phase: 'design',
      input_signature: signature,
      reviewer: '',
      checked_at: '',
    } satisfies Rationale;
  });
  s.design_stages = [
    {
      id: 'analysis',
      input_signature: canonicalJson(s.requirements),
      output_ids: ['goal', 'audience', 'entry_level', 'constraints'],
    },
    { id: 'outcomes', input_signature: signature, output_ids: s.outcomes.map((o) => o.id) },
    {
      id: 'assessment_and_criteria',
      input_signature: signature,
      output_ids: s.assessments.map((a) => a.id),
    },
    { id: 'practice', input_signature: signature, output_ids: s.activities.map((a) => a.id) },
    {
      id: 'content_and_prerequisites',
      input_signature: signature,
      output_ids: s.topics.map((t) => t.id),
    },
    { id: 'time_and_calendar', input_signature: signature, output_ids: ['hours', 'calendar'] },
  ];
}
// Conservative invalidation: any design input change requires review of all prior claims.
// Historical snapshots are never mutated; new records retain their original evidence.
export function invalidateRationales(s: Skeleton, previous?: Skeleton) {
  const signature = rationaleSignature(s);
  if (!previous?.rationales || rationaleSignature(previous) === signature) return;
  const ids = new Set(skeletonElements(s).map((e) => e.id));
  s.rationales = (s.rationales || previous.rationales)
    .filter((r) => ids.has(r.element_id))
    .map((r) => {
      const old = previous.rationales?.find((p) => p.id === r.id);
      return {
        ...r,
        status: 'stale',
        version: old && old.status !== 'stale' ? old.version + 1 : r.version,
      };
    });
}
export function sourceById(
  s: Skeleton,
  id: string | null,
): Requirements['references'][number] | undefined {
  return [...s.requirements.references, ...(s.rationale_sources || [])].find(
    (source) => source.id === id,
  );
}
export function rationaleIsSupported(s: Skeleton, r: Rationale, signature = rationaleSignature(s)) {
  if (
    r.input_signature !== signature ||
    !['confirmed', 'expert_checked', 'pilot_checked'].includes(r.status)
  )
    return false;
  if (r.kind === 'request') {
    const field = r.coordinate.replace(/^requirements\./, '');
    const value = s.requirements[field as keyof Requirements];
    return (
      r.source_id === 'request' &&
      r.coordinate.startsWith('requirements.') &&
      typeof value === 'string' &&
      value === r.fragment &&
      !!r.fragment
    );
  }
  if (r.kind === 'calculation') {
    const topic = s.topics.find((t) => `hours:${t.id}` === r.element_id);
    return (
      !!topic &&
      r.verification === `${sumHours(Object.values(topic.hours))} = ${topic.planned_total}` &&
      sumHours(Object.values(topic.hours)) === topic.planned_total
    );
  }
  if (r.kind === 'expert')
    return !!r.reviewer && !!r.checked_at && ['expert_checked', 'pilot_checked'].includes(r.status);
  const source = sourceById(s, r.source_id);
  return (
    !!source &&
    source.provenance?.access === 'read' &&
    source.provenance.content === 'confirmed' &&
    !!r.fragment &&
    source.text.includes(r.fragment) &&
    !!r.coordinate &&
    !!r.applicability &&
    !!r.limitations &&
    !!r.reviewer &&
    !!r.checked_at &&
    ['expert_checked', 'pilot_checked'].includes(r.status)
  );
}
export function rationaleCoverage(s: Skeleton) {
  const signature = rationaleSignature(s);
  const counts = { confirmed: 0, expert: 0, assumptions: 0, gaps: 0 };
  for (const e of skeletonElements(s)) {
    const records = currentRationales(s, e.id, signature);
    // Exclusive categories: no double counting elements with several pieces of evidence.
    if (records.some((r) => rationaleIsSupported(s, r, signature))) {
      if (
        records.some(
          (r) =>
            ['expert_checked', 'pilot_checked'].includes(r.status) &&
            rationaleIsSupported(s, r, signature),
        )
      )
        counts.expert++;
      else counts.confirmed++;
    } else if (records.some((r) => r.kind === 'assumption' && r.status !== 'stale'))
      counts.assumptions++;
    else counts.gaps++;
  }
  return counts;
}
