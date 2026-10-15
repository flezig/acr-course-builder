import { expect, test } from 'vitest';
import { makeSkeleton } from '../src/entities/course/model/factory';
import { presets } from '../src/entities/course/model/presets';
import { buildCoverage } from '../src/pages/competencies/coverage-model';
import { outcomeReviewSignature } from '../src/pages/competencies/outcome-review-model';
const skeleton = () => makeSkeleton(presets.find((preset) => preset.id === 'python')!.requirements);
test('Связи и критерии не означают проверенное соответствие; изменение снимает проверку', () => {
  const s = skeleton();
  const id = s.outcomes[0].id;
  s.topics = [{ ...s.topics[0], outcome_ids: [id] }];
  s.assessments = s.assessments
    .filter((a) => a.outcome_ids.includes(id))
    .map((a) => ({
      ...a,
      topic_id: s.topics[0].id,
    }));
  expect(buildCoverage(s)[0].gaps).toEqual([]);
  expect(buildCoverage(s)[0].reviewed).toBe(false);
  s.outcomes[0].review = { signature: outcomeReviewSignature(s, id), checked_at: '2026-10-15' };
  expect(buildCoverage(s)[0].reviewed).toBe(true);
  s.assessments[0].criterion += ' Изменение';
  expect(buildCoverage(s)[0].reviewed).toBe(false);
});
test('Тема без проверки и задание без критерия диагностируются независимо', () => {
  const s = skeleton();
  const [first, second] = s.outcomes;
  s.topics = [{ ...s.topics[0], outcome_ids: [first.id, second.id] }];
  s.assessments = [{ ...s.assessments[0], outcome_ids: [second.id], criterion: '  ' }];
  second.criteria = ['Общий критерий результата'];
  const rows = buildCoverage(s);
  expect(rows[0].gaps).toContain('Нет проверочного задания');
  expect(rows[0].topics).toHaveLength(1);
  expect(rows[1].missingCriteria).toBe(true);
});
test('Общий проект не получает выдуманную детализацию; topic_id не заменяет связь с темой', () => {
  const s = skeleton();
  s.topics.forEach((topic) => {
    topic.outcome_ids = [];
  });
  s.assessments = [{ ...s.assessments[0], outcome_ids: s.outcomes.map((outcome) => outcome.id) }];
  expect(buildCoverage(s)[0].gaps).toEqual(
    expect.arrayContaining([
      'Нет связанных тем',
      'Тема задания не связана с результатом или отсутствует',
      'Общее задание: нет детализации по результату',
    ]),
  );
});

test('Итоговая аттестация не заменяет тему обучения', () => {
  const s = skeleton();
  s.topics = [{ ...s.topics[0], id: 'topic-final', outcome_ids: [s.outcomes[0].id] }];
  expect(buildCoverage(s)[0].topics).toHaveLength(0);
  expect(buildCoverage(s)[0].gaps).toContain('Нет связанных тем');
});

test.each([0, 1, 2, 3])('Покрытие требует два средства: %i средств', (count) => {
  const s = skeleton();
  const id = s.outcomes[0].id;
  const types = ['test', 'practical', 'project'] as const;
  s.assessments = types.slice(0, count).map((type, index) => ({
    ...s.assessments[0],
    id: `check-${index}`,
    outcome_ids: [id],
    type,
  }));
  const row = buildCoverage(s)[0];
  expect(row.missingAssessments).toBe(count < 2);
  if (count === 1) expect(row.gaps).toContain('Нужно второе оценочное средство');
});

test('Два задания одного типа считаются двумя средствами', () => {
  const s = skeleton();
  const first = s.assessments[0];
  s.assessments = [first, { ...first, id: 'another-test' }];
  expect(buildCoverage(s)[0].missingAssessments).toBe(false);
});
