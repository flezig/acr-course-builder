import { expect, test } from 'vitest';
import { makeSkeleton } from '../src/entities/course/model/factory';
import { presets } from '../src/entities/course/model/presets';
import { buildMap, relatedChain } from '../src/pages/competencies/map-model';
const skeleton = () => makeSkeleton(presets.find((p) => p.id === 'python')!.requirements);
test('Одного оценочного средства достаточно для наличия проверки; общие карточки не дублируются', () => {
  const s = skeleton();
  const ids = s.outcomes.map((o) => o.id);
  s.topics = [{ ...s.topics[0], outcome_ids: ids }];
  s.activities = [];
  s.assessments = [{ ...s.assessments[0], outcome_ids: ids }];
  const { nodes, edges } = buildMap(s);
  expect(nodes.filter((n) => n.column === 1).every((n) => n.status === 'Нет практики')).toBe(true);
  expect(nodes.filter((n) => n.column === 3)).toHaveLength(1);
  expect(
    edges.filter(
      (e) => e.to === `assessment:${s.assessments[0].id}` && e.from.startsWith('outcome:'),
    ),
  ).toHaveLength(ids.length);
  const chain = relatedChain(`outcome:${ids[0]}`, nodes, edges);
  expect(chain.has(`topic:${s.topics[0].id}`)).toBe(true);
  expect(chain.has(`outcome:${ids[1]}`)).toBe(false);
});
test('Пробелы вычисляются по существующим результатам, без вывода покрытия из topic_id', () => {
  const s = skeleton();
  s.activities = [];
  s.topics.forEach((t) => (t.outcome_ids = []));
  s.assessments.forEach((a) => (a.outcome_ids = ['missing']));
  const { nodes } = buildMap(s);
  expect(
    nodes.filter((n) => n.column === 1).every((n) => n.status === 'Нет обучения · Нет оценивания'),
  ).toBe(true);
  expect(nodes.filter((n) => n.column > 1).every((n) => n.gap)).toBe(true);
});

test('Отсутствующее требование — пробел, а несвязанные источники остаются на карте', () => {
  const s = skeleton();
  s.outcomes[0].requirement_id = 'missing-reference';
  s.requirements.references.push({
    id: 'reference-extra',
    name: 'Новое основание',
    text: 'Уточнённое требование',
    url: '',
    status: 'provided',
    coordinate: '',
    claim: '',
    checked_at: new Date().toISOString(),
    scope: '',
    hash: '',
  });
  const { nodes, edges } = buildMap(s);
  expect(nodes.find((n) => n.id === `outcome:${s.outcomes[0].id}`)?.gap).toBe(true);
  expect(nodes.find((n) => n.id === 'requirement:reference-extra')?.gap).toBe(true);
  expect(nodes.some((n) => n.id === 'requirement:missing-reference')).toBe(false);
  expect(edges.some((e) => e.from === 'requirement:missing-reference')).toBe(false);
});

test('Короткие подписи сохраняют исходные формулировки и не меняют данные', () => {
  const s = makeSkeleton(presets.find((p) => p.id === 'teachers')!.requirements);
  const before = structuredClone(s);
  const { nodes } = buildMap(s);
  const result = nodes.find((n) => n.column === 1)!;
  expect(result.title).toBe('Риски, этика и данные детей');
  expect(result.originalTitle).toBe(s.outcomes[0].description);
  expect(result.description).toBe(s.outcomes[0].description);
  expect(
    nodes
      .filter((n) => n.column === 3)
      .slice(0, 2)
      .map((n) => n.title),
  ).toEqual([result.title, result.title]);
  expect(s).toEqual(before);
});
