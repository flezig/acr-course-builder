import type { Skeleton } from '../../entities/course/model/schema';
import { assessmentLabels, kindLabels } from '../../entities/course/model/presets';
export type MapNode = {
  id: string;
  sourceId: string;
  column: number;
  title: string;
  originalTitle: string;
  warnings: string[];
  type: string;
  description: string;
  status: string;
  gap: boolean;
  kind?: string;
  criterion?: string;
};
/** Display labels only: the source title and wording remain available in details. */
export function compactMapTitle(text: string) {
  return (
    text
      .replace(/^Разбор примера и самостоятельное выполнение:\s*/i, '')
      .replace(/^Демонстрирует действие:\s*/i, '')
      .replace(/^Выполняет учебную задачу\s*(?:по теме\s*)?[:«"—–-]*\s*/i, '')
      .replace(/^Объясняет решение по теме\s*[:«"—–-]*\s*/i, '')
      .replace(/ и объясняет решение$/i, '')
      .replace(/[»"]$/, '') || text
  );
}
export function buildMap(s: Skeleton) {
  const nodes: MapNode[] = [];
  const edges: { from: string; to: string }[] = [];
  const validOutcomes = new Set(s.outcomes.map((o) => o.id));
  const linked = (ids: string[]) => ids.some((id) => validOutcomes.has(id));
  const requirementExists = (id: string) =>
    !!s.requirements.references.find((r) => r.id === id) ||
    (typeof s.requirements[id as keyof typeof s.requirements] === 'string' &&
      !!s.requirements[id as keyof typeof s.requirements]);
  const requirementIds = [
    ...new Set([
      ...(s.requirements.request ? ['request'] : []),
      ...s.requirements.references.map((r) => r.id),
      ...s.outcomes.map((o) => o.requirement_id).filter((id) => id && requirementExists(id)),
    ]),
  ];
  for (const id of requirementIds) {
    const ref = s.requirements.references.find((r) => r.id === id);
    const field = s.requirements[id as keyof typeof s.requirements];
    const description =
      ref?.text ||
      (typeof field === 'string' ? field : '') ||
      'Формулировка требования отсутствует в данных';
    nodes.push({
      id: `requirement:${id}`,
      sourceId: id,
      column: 0,
      title: id === 'request' ? 'Исходный запрос' : ref?.name || 'Требование программы',
      originalTitle: id === 'request' ? 'Исходный запрос' : ref?.name || 'Требование программы',
      warnings: s.outcomes.some((o) => o.requirement_id === id) ? [] : ['Не связан с результатами'],
      type: 'Требование',
      description,
      status: s.outcomes.some((o) => o.requirement_id === id) ? '' : 'Не связан с результатами',
      gap: !s.outcomes.some((o) => o.requirement_id === id),
    });
  }
  for (const o of s.outcomes) {
    const topic = s.topics.some((t) => t.outcome_ids.includes(o.id));
    const practice = s.activities.some((t) => t.outcome_ids.includes(o.id));
    const learning = topic && practice;
    const assessment = s.assessments.some((a) => a.outcome_ids.includes(o.id));
    const requirement = requirementIds.includes(o.requirement_id);
    const warnings = [
      !requirement && 'Нет требования',
      !topic && !practice ? 'Нет обучения' : !topic ? 'Нет темы' : !practice ? 'Нет практики' : '',
      !assessment && 'Нет оценивания',
    ].filter((label): label is string => !!label);
    const status = warnings.join(' · ');
    nodes.push({
      id: `outcome:${o.id}`,
      sourceId: o.id,
      column: 1,
      title: o.title || compactMapTitle(o.description),
      originalTitle: o.description,
      warnings,
      description: o.description,
      type: o.kind === 'knowledge' ? 'Знание' : o.kind === 'skill' ? 'Умение' : kindLabels[o.kind],
      kind: o.kind,
      status,
      gap: !requirement || !learning || !assessment,
    });
    if (requirement) edges.push({ from: `requirement:${o.requirement_id}`, to: `outcome:${o.id}` });
  }
  for (const [collection, column, prefix] of [
    [s.topics, 2, 'topic'],
    [s.activities, 2, 'activity'],
    [s.assessments, 3, 'assessment'],
  ] as const) {
    for (const item of collection) {
      const gap = !linked(item.outcome_ids);
      const title =
        'title' in item ? item.title : 'action' in item ? item.action : item.description;
      nodes.push({
        id: `${prefix}:${item.id}`,
        sourceId: item.id,
        column,
        title: compactMapTitle(title),
        originalTitle: title,
        warnings: gap ? ['Не связан с результатами'] : [],
        description: 'content' in item ? item.content : title,
        type:
          'type' in item
            ? assessmentLabels[item.type]
            : prefix === 'topic'
              ? 'Тема'
              : 'Практика',
        status: gap ? 'Не связан с результатами' : '',
        gap,
        criterion: 'criterion' in item ? item.criterion : undefined,
      });
      for (const id of new Set(item.outcome_ids))
        if (validOutcomes.has(id))
          edges.push({ from: `outcome:${id}`, to: `${prefix}:${item.id}` });
      // Topic association is explicit; it does not imply coverage of other outcomes.
      if ('topic_id' in item && column === 3 && s.topics.some((t) => t.id === item.topic_id))
        edges.push({ from: `topic:${item.topic_id}`, to: `${prefix}:${item.id}` });
    }
  }
  return { nodes, edges };
}
export function relatedChain(id: string, nodes: MapNode[], edges: { from: string; to: string }[]) {
  const selected = nodes.find((n) => n.id === id);
  const results = new Set<string>(
    selected?.column === 1
      ? [id]
      : edges
          .filter((e) => e.from === id || e.to === id)
          .flatMap((e) => [e.from, e.to])
          .filter((key) => key.startsWith('outcome:')),
  );
  const related = new Set([id, ...results]);
  for (const e of edges)
    if (e.from === id || e.to === id || results.has(e.from) || results.has(e.to)) {
      related.add(e.from);
      related.add(e.to);
    }
  return related;
}
