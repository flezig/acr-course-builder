import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesign, topicRange } from '../src/steps/draft-skeleton.ts';

const topic = (title: string, outcomes: number[], prerequisites: number[] = []) => ({
  title,
  content: 'Разбор и практика',
  profile: 'tool' as const,
  weight: 3,
  weight_reason: 'Средняя трудоёмкость',
  outcomes,
  prerequisites,
  control: 'Практическое задание',
});

const outcome = (title: string) => ({
  kind: 'skill' as const,
  title,
  description: title,
  criteria: ['Выполняет задание'],
});

test('итоговая аттестация от модели убирается, номера зависимостей пересчитываются', () => {
  const { design, issues } = normalizeDesign(
    {
      goal: 'Цель',
      tasks: ['Задача'],
      outcomes: [outcome('Применяет Python'), outcome('Строит графики')],
      modules: [
        { title: 'Основы', topics: [topic('Синтаксис', [1]), topic('Pandas', [1], [1])] },
        { title: 'Итоговая аттестация', topics: [topic('Защита итогового проекта', [1, 2])] },
        { title: 'Визуализация', topics: [topic('Графики', [2], [2])] },
      ],
    },
    24,
  );
  assert.deepEqual(design.module_titles, ['Основы', 'Визуализация']);
  assert.deepEqual(
    design.topics.map((t) => [t.module, t.title, t.prerequisites]),
    [
      [1, 'Синтаксис', []],
      [1, 'Pandas', [1]],
      [2, 'Графики', [2]],
    ],
  );
  assert.ok(issues.some((issue) => issue.includes('Итоговую аттестацию')));
});

test('ссылки на несуществующие результаты и более поздние темы убираются с пометкой', () => {
  const { design, issues } = normalizeDesign(
    {
      goal: 'Цель',
      tasks: ['Задача'],
      outcomes: [outcome('Первый'), outcome('Второй')],
      modules: [{ title: 'Модуль', topics: [topic('А', [1, 7], [2]), topic('Б', [1])] }],
    },
    16,
  );
  assert.deepEqual(design.topics[0].outcomes, [1]);
  assert.deepEqual(design.topics[0].prerequisites, []);
  assert.ok(issues.some((issue) => issue.includes('«Второй» не формирует')));
});

test('число тем подбирается под объём', () => {
  assert.deepEqual(topicRange(16), { min: 3, max: 7 });
  assert.deepEqual(topicRange(72), { min: 6, max: 24 });
  assert.deepEqual(topicRange(500), { min: 24, max: 24 });
});
