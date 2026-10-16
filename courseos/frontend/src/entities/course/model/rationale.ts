import { instructionalAgentsReference } from './instructional-agents-reference';
import type { Rationale, Skeleton, Snapshot, Requirements } from './schema';
import { canonicalJson, sumHours } from '../../../shared/lib/decimal';
import { assessmentLabels } from './presets';

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
    const confirmed = !!requestValue && (e.id !== 'goal' || requestValue === s.goal);
    return {
      id: `rationale:${e.id}`,
      element_id: e.id,
      version: 1,
      decision: e.decision,
      purpose: `Для аудитории «${s.requirements.audience}». Связанные элементы: ${e.related.join(', ') || 'вводные курса'}. ${confirmed ? 'Сохранено условие запроса.' : 'Предложение демонстрационного проектировщика; необходимость требует предметной проверки.'}`,
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
const safe = (text: string) => text.replace(/\r/g, '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const basisLabels: Record<Rationale['kind'], string> = {
  request: 'Условие заказчика',
  subject_reference: 'Учебный или предметный источник',
  research: 'Исследование',
  calculation: 'Расчёт',
  expert: 'Заключение специалиста',
  assumption: 'Предварительное предложение',
  gap: 'Объяснение пока не найдено',
};
const statusLabels: Record<Rationale['status'], string> = {
  unverified: 'Ещё не проверено',
  partial: 'Подтверждено лишь частично',
  confirmed: 'Подтверждено в указанных пределах',
  expert_checked: 'Проверено специалистом',
  pilot_checked: 'Проверено на пробном обучении',
  stale: 'После изменений нужна повторная проверка',
};
const hourLabels = {
  lecture: 'объяснение преподавателя',
  practice: 'практические занятия',
  lab: 'лабораторные работы',
  self_study: 'самостоятельная работа',
  assessment: 'проверка результатов',
};

export function skeletonRationaleMarkdown(snapshot: Snapshot): string {
  const s = snapshot.skeleton;
  const req = s.requirements;
  const signature = rationaleSignature(s);
  const elements = skeletonElements(s);
  const names = new Map(elements.map((e, i) => [e.id, `${e.title} (${i + 1})`]));
  for (const [i, outcome] of s.outcomes.entries())
    names.set(outcome.id, `Результат ${i + 1}: ${outcome.description}`);
  for (const topic of s.topics) names.set(topic.id, topic.title);
  const readable = (value: string) => {
    let result = value;
    for (const [id, name] of [...names].sort((a, b) => b[0].length - a[0].length)) {
      result = result.replaceAll(id, name);
    }
    return result
      .replaceAll('time_budgets', 'распределении времени по учебным действиям')
      .replaceAll(
        'Предложение демонстрационного проектировщика; необходимость требует предметной проверки.',
        'Это предложение из готового примера. Преподавателю нужно проверить, подходит ли оно группе.',
      )
      .replaceAll('Сохранено условие запроса.', 'Такое условие указано в запросе заказчика.');
  };
  const approvedAtCreation =
    snapshot.approval_at_creation ??
    snapshot.approvals.some(
      (a) =>
        a.skeleton_hash === snapshot.skeleton_hash &&
        a.skeleton_version === snapshot.skeleton_version &&
        a.approved_at <= snapshot.created_at,
    );
  const lines = [
    `# ${req.title}`,
    'Описание курса и пояснения к учебному плану.',
    `Версия курса: ${snapshot.course_version}. ${approvedAtCreation ? 'На момент сохранения план был утверждён.' : 'На момент сохранения план ещё не был утверждён.'}`,
    snapshot.mode === 'demo'
      ? 'Это демонстрационный пример: план собран по заранее подготовленному шаблону. Его нужно обсудить с преподавателем перед запуском. Отметка об утверждении в демо не означает, что курс прошёл независимую экспертизу.'
      : 'Описание составлено по сохранённым данным курса. Утверждение плана не заменяет проверку содержания и заданий специалистом.',
    '## Для кого и зачем этот курс',
    `**Участники:** ${req.audience || 'Нужно уточнить.'}`,
    `**Что нужно знать до начала:** ${req.entry_level || 'Входной уровень пока не определён.'}`,
    `**Цель:** ${s.goal || 'Нужно уточнить.'}`,
    `**Объём:** ${req.total_hours || 'не указан'} ч. **Формат:** ${req.delivery || 'нужно уточнить'}.`,
    `**Итоговая работа:** ${req.assessment || 'Способ проверки результатов ещё не выбран.'}`,
  ];
  if (req.constraints) lines.push(`**Что нужно учесть:** ${req.constraints}`);
  lines.push(
    '## Чему научатся участники',
    ...s.outcomes.map((o, i) => `${i + 1}. ${o.description}`),
  );
  if (!s.outcomes.length) lines.push('Результаты обучения ещё нужно сформулировать.');
  lines.push('## Как будет проходить обучение');
  const cell = (value: string) => value.replace(/\|/g, '&#124;').replace(/\n/g, ' ');
  lines.push(
    '| Тема | Что изучаем | Часы | Как проверяем |',
    '|---|---|---:|---|',
    ...s.topics.map(
      (t) => `| ${cell(t.title)} | ${cell(t.content)} | ${t.planned_total} | ${cell(t.control)} |`,
    ),
    `Всего по темам: ${sumHours(s.topics.map((t) => t.planned_total))} ч.`,
  );
  if (s.activities.length)
    lines.push(
      '### Что участники будут делать на практике',
      ...s.activities.map(
        (a) =>
          `- **${s.topics.find((t) => t.id === a.topic_id)?.title || 'Практика'}:** ${a.description}`,
      ),
    );
  lines.push('## Как понять, что цель достигнута');
  for (const a of s.assessments)
    lines.push(
      `### ${assessmentLabels[a.type]}`,
      a.action,
      `**Критерий успешной работы:** ${a.criterion}`,
    );
  lines.push(
    '## Когда и с какой нагрузкой заниматься',
    req.calendar.description || 'Расписание ещё нужно согласовать.',
    `Начало: ${req.calendar.start || 'дата не выбрана'}. Период: ${req.calendar.calendar_days || 'не определён'} календарных дней. Нагрузка за день: ${req.calendar.daily_limit ? `до ${req.calendar.daily_limit} ч` : 'нужно уточнить'}.`,
    req.calendar.confirmed
      ? 'Условия календаря подтверждены в запросе.'
      : 'Условия календаря пока не подтверждены.',
    s.sessions?.length
      ? 'Даты и виды работы отдельных занятий приведены в согласованном расписании. Итоговая аттестация включена один раз.'
      : 'Вместимость проверена; расписание не составлено. Уточните единицы часов и назначьте занятия.',
  );
  if (s.conflicts.length) {
    lines.push('### Что мешает выполнить план');
    for (const conflict of s.conflicts) {
      lines.push(
        `**${conflict.status === 'resolved' ? 'Решение принято' : 'Нужно принять решение'}.** ${conflict.expected}. ${conflict.actual}.`,
        conflict.calculation,
      );
      if (conflict.decision) {
        const decisionLabels: Record<string, string> = {
          extend: 'увеличить срок обучения',
          raise: 'увеличить дневную нагрузку',
          reduce: 'сократить объём курса',
        };
        lines.push(
          `Выбранный вариант: ${conflict.options.find((o) => o.id === conflict.decision?.option_id)?.title || decisionLabels[conflict.decision.option_id] || 'решение записано в сохранённой версии'}. Текущие условия приведены в разделе о календаре.`,
        );
      } else lines.push(...conflict.options.map((o) => `- ${o.title}: ${o.consequence}`));
    }
  }
  lines.push('## Почему план устроен так');
  for (const explanation of s.explanations)
    lines.push(
      `### ${explanation.title}`,
      readable(explanation.conclusion),
      readable(explanation.detail),
      `**Что ещё проверить:** ${explanation.missing || 'Дополнительные вопросы не указаны.'}`,
    );
  const coverage = rationaleCoverage(s);
  lines.push(
    '## Что уже известно, а что требует проверки',
    'Условия заказчика подтверждают, какой курс он хочет получить. Расчёты подтверждают сумму часов. Достаточно ли этого времени для обучения конкретной группы, должны оценить преподаватель и пробный запуск.',
    '| Основания решений | Количество элементов |',
    '|---|---:|',
    `| Подтверждено запросом, расчётом или проверенным источником | ${coverage.confirmed} |`,
    `| Проверено специалистом или на пробном обучении | ${coverage.expert} |`,
    `| Пока остаётся предположением | ${coverage.assumptions} |`,
    `| Объяснение неполное, отсутствует или требует обновления | ${coverage.gaps} |`,
    `| Всего | ${elements.length} |`,
    'Каждый элемент учтён один раз. Эти числа описывают основания решений, а не оценку качества курса.',
    '### Результаты автоматической проверки',
    ...snapshot.audit.checks.map(
      (check) =>
        `- **${check.title}:** ${{ passed: 'проверка пройдена', failed: 'найдена проблема', not_run: 'проверка не проводилась' }[check.status]}. ${readable(check.actual)}`,
    ),
    'Педагогическая проверка специалистом пока не проведена. Автоматические проверки структуры не подтверждают качество обучения.',
    '## Источники и их ограничения',
    'Ссылка сама по себе не подтверждает решение. Важно, какой текст прочитан и относится ли он к этой аудитории и задаче.',
  );
  const sources = [...req.references, ...(s.rationale_sources || [])];
  for (const source of sources) {
    const p = source.provenance;
    lines.push(`### ${source.name}`);
    if (source.url) lines.push(`[Открыть источник](${source.url})`);
    if (p?.authors || p?.year) lines.push([p.authors, p.year].filter(Boolean).join(', '));
    lines.push(
      `**Что известно:** ${p?.result || source.claim || 'Связь с решениями курса ещё нужно проверить.'}`,
      `**Что прочитано:** ${p ? { none: 'текст не прочитан', excerpt: 'отдельный фрагмент', abstract: 'аннотация', full_text: 'полный текст' }[p.extent] : 'нет сведений'}. ${p?.content === 'confirmed' ? 'Содержание подтверждено в сохранённых данных.' : 'Содержание ещё не подтверждено.'}`,
    );
    if (p?.population) lines.push(`**Кого изучали:** ${p.population}`);
    if (source.text) lines.push(`**Сохранённый фрагмент:** ${source.text}`);
    if (source.scope) lines.push(`**Границы применения:** ${source.scope}`);
  }
  if (!sources.length)
    lines.push('Источники пока не добавлены. Основание не найдено; требуется проверка.');
  lines.push(
    '## Подробные пояснения к решениям',
    'Этот раздел нужен для обсуждения плана с методистом. Здесь отдельно показаны условия запроса, предложения и непроверенные решения.',
  );
  for (const [i, element] of elements.entries()) {
    let decision = readable(element.decision);
    const topic = s.topics.find((t) => `hours:${t.id}` === element.id);
    if (topic) {
      decision = `${topic.planned_total} ч: ${Object.entries(topic.hours)
        .filter(([, hours]) => Number(hours) > 0)
        .map(([kind, hours]) => `${hourLabels[kind as keyof typeof hourLabels]} — ${hours} ч`)
        .join('; ')}.`;
      const budget = s.time_budgets?.find((b) => b.topic_id === topic.id);
      if (budget) decision += ` ${budget.note}`;
    }
    if (element.id === 'calendar')
      decision = req.calendar.description || 'Расписание нужно согласовать.';
    const conflict = s.conflicts.find((c) => c.id === element.id);
    if (conflict) decision = `${conflict.expected}. ${conflict.actual}. ${conflict.calculation}`;
    lines.push(
      `### ${i + 1}. ${element.title.replace(/Оценочное средство: (\w+)/, (_, type: keyof typeof assessmentLabels) => `Проверка: ${assessmentLabels[type] || type}`)}`,
      decision,
    );
    const records = currentRationales(s, element.id, signature);
    if (!records.length) lines.push(missingBasis);
    for (const record of records) {
      const source = sourceById(s, record.source_id);
      lines.push(
        `**${basisLabels[record.kind]}. ${statusLabels[record.status]}.**`,
        `**Почему это предложено:** ${readable(record.purpose)}`,
        `**На что опираемся:** ${record.source_id === 'request' ? 'Сохранённый запрос заказчика.' : source?.name || 'Подтверждающий источник пока не указан.'}`,
      );
      if (record.fragment) lines.push(`**Фрагмент основания:** ${record.fragment}`);
      lines.push(
        `**Что это подтверждает:** ${readable(record.applicability)}`,
        `**Другие варианты:** ${readable(record.alternatives)}`,
        `**Насколько можно опираться:** ${record.trust}`,
        `**Ограничения:** ${record.limitations}`,
        `**Что проверено:** ${record.verification}${record.reviewer ? ` Проверял: ${record.reviewer}, ${record.checked_at || 'дата не указана'}.` : ''}`,
        `**Следующий шаг:** ${record.next_check}`,
      );
      if (!rationaleIsSupported(s, record, signature))
        lines.push('Этого основания пока недостаточно, чтобы считать решение подтверждённым.');
    }
  }
  if (s.sessions?.length)
    lines.push(
      '## Согласованное расписание',
      ...s.sessions.map(
        (session) =>
          `${session.date}: ${s.topics.find((t) => t.id === session.topic_id)?.title}; ${Object.entries(
            session.hours,
          )
            .filter(([, v]) => Number(v) > 0)
            .map(([k, v]) => `${k}: ${v} ч`)
            .join(', ')}`,
      ),
    );
  if (snapshot.sections.length)
    lines.push(
      '## Разделы программы',
      ...snapshot.sections.flatMap((section) => [`### ${section.title}`, section.content]),
    );
  if (snapshot.materials.length) {
    lines.push('## Созданные материалы');
    for (const material of snapshot.materials) {
      lines.push(
        `### ${material.title}`,
        material.content,
        `Ожидаемый результат: ${material.expected}`,
        ...material.criteria.map((criterion) => `- ${criterion}`),
      );
      if (material.test_policy)
        lines.push(
          `Вопросов: ${material.questions.length}; порог: ${material.test_policy.pass_count} верных ответов.`,
        );
      for (const question of material.questions)
        lines.push(
          question.text,
          ...question.options.map((option, i) => `${i + 1}. ${option}`),
          `Ключ: ${question.correct_index + 1}. ${question.explanation}`,
          `Результаты: ${question.outcome_ids.join(', ')}`,
        );
      for (const slide of material.slides)
        lines.push(
          `#### ${slide.title}`,
          ...slide.bullets.map((bullet) => `- ${bullet}`),
          `Заметки преподавателя: ${slide.notes}`,
        );
      for (const dataset of material.datasets || [])
        lines.push(
          `#### Данные: ${dataset.name}`,
          dataset.description,
          `| ${dataset.columns.join(' | ')} |`,
          `| ${dataset.columns.map(() => '---').join(' | ')} |`,
          ...dataset.rows.map(
            (row) => `| ${row.map((value) => cell(String(value ?? 'NULL'))).join(' | ')} |`,
          ),
        );
    }
  }
  if (snapshot.decisions.length)
    lines.push(
      '## Принятые исключения',
      ...snapshot.decisions.map(
        (decision) =>
          `Исходное замечание: ${decision.finding || decision.issue_id}. Причина: ${decision.reason}. Область: ${decision.scope || 'сохранённая версия'}; hash: ${decision.scope_hash || snapshot.skeleton_hash}. Решение не подтверждает соответствие требованию.`,
      ),
    );
  lines.push(
    '## О работе с этим описанием',
    snapshot.mode === 'demo'
      ? 'В демонстрационном режиме используются заранее подготовленные сценарии без генерации моделью. Поиск и чтение внешних файлов, независимая экспертиза и пробное обучение не выполняются.'
      : 'Описание использует только выбранную сохранённую версию с сервера. При недоступности сервера демонстрационные данные не подставляются.',
    'Если меняются аудитория, результаты, часы или источники, прежние пояснения нужно пересмотреть. Описание старой версии продолжает отражать её сохранённые данные.',
    '## Сведения о сохранённой версии',
    `Курс: ${snapshot.course_id}. Версия курса: ${snapshot.course_version}. Версия плана: ${snapshot.skeleton_version}.`,
    `Сохранено: ${snapshot.created_at}. Режим: ${snapshot.mode}. Происхождение: ${snapshot.provenance}.`,
    `SHA-256 каркаса: ${snapshot.skeleton_hash}.`,
    'Контрольная сумма позволяет сопоставить это описание с исходными данными той же версии.',
    '### Указатели для сверки оснований',
    ...elements.flatMap((element, i) => [
      `- Пункт ${i + 1}: ${element.id}.`,
      ...currentRationales(s, element.id, signature).map(
        (record) =>
          `  - ${record.id}, версия ${record.version}; источник: ${record.source_id || 'не указан'}; место в источнике: ${record.coordinate || 'не указано'}; этап: ${record.phase === 'design' ? 'проектирование' : 'последующая проверка'}.`,
      ),
    ]),
    '### Сведения об источниках для сверки',
    ...sources.map(
      (source) =>
        `- ${source.id}: ${source.name}; контрольная сумма: ${source.hash || 'не указана'}; место в источнике: ${source.coordinate || 'не указано'}; DOI: ${source.provenance?.doi || 'не указан'}.`,
    ),
    ...s.conflicts
      .filter((conflict) => conflict.decision)
      .map(
        (conflict) =>
          `Изменение календаря ${conflict.id}. До: ${conflict.decision!.before}. После: ${conflict.decision!.after}.`,
      ),
    instructionalAgentsReference,
  );
  return (
    lines
      .map(safe)
      .join('\n\n')
      .replace(/(\|[^\n]*\|)\n\n(?=\|)/g, '$1\n') + '\n'
  );
}
