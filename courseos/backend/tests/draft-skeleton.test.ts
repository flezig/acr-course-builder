import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmGateway } from '../src/llm/gateway.ts';
import { normalizeQuestions } from '../src/steps/clarify-questions.ts';
import {
  draftSkeleton,
  normalizeDesign,
  outcomeRange,
  topicRange,
} from '../src/steps/draft-skeleton.ts';

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
      design_notes: null,
      outcomes: [outcome('Применяет Python'), outcome('Строит графики')],
      modules: [
        { title: 'Основы', topics: [topic('Синтаксис', [1]), topic('Pandas', [1], [1])] },
        { title: 'Итоговая аттестация', topics: [topic('Защита итогового проекта', [1, 2])] },
        { title: 'Визуализация', topics: [topic('Графики', [2], [2])] },
        {
          title: 'Интеграция и итоговая аттестация',
          topics: [topic('Сквозной проект', [1, 2], [4]), topic('Итоговая аттестация', [1])],
        },
      ],
    },
    24,
  );
  assert.deepEqual(design.module_titles, [
    'Основы',
    'Визуализация',
    'Интеграция и итоговая аттестация',
  ]);
  assert.deepEqual(
    design.topics.map((t) => [t.module, t.title, t.prerequisites]),
    [
      [1, 'Синтаксис', []],
      [1, 'Pandas', [1]],
      [2, 'Графики', [2]],
      [3, 'Сквозной проект', [3]],
    ],
  );
  assert.ok(issues.some((issue) => issue.includes('Итоговую аттестацию')));
});

test('ссылки на несуществующие результаты и более поздние темы убираются с пометкой', () => {
  const { design, issues } = normalizeDesign(
    {
      goal: 'Цель',
      tasks: ['Задача'],
      design_notes: null,
      outcomes: [outcome('Первый'), outcome('Второй'), outcome('Третий')],
      modules: [{ title: 'Модуль', topics: [topic('А', [1, 7], [2]), topic('Б', [3])] }],
    },
    16,
  );
  assert.deepEqual(design.topics[0].outcomes, [1]);
  assert.deepEqual(design.topics[0].prerequisites, []);
  // «Второй» убран, поэтому «Третий» становится вторым результатом.
  assert.deepEqual(
    design.outcomes.map((o) => o.title),
    ['Первый', 'Третий'],
  );
  assert.deepEqual(design.topics[1].outcomes, [2]);
  assert.ok(issues.some((issue) => issue.includes('«Второй» не формирует ни одна тема — убран')));
});

test('число тем подбирается под объём', () => {
  assert.deepEqual(topicRange(16), { min: 3, max: 7 });
  assert.deepEqual(topicRange(72), { min: 6, max: 24 });
  assert.deepEqual(topicRange(500), { min: 24, max: 24 });
});

test('вопросы модели получают устойчивые id, а рекомендация — один из вариантов', () => {
  const questions = normalizeQuestions([
    {
      label: ' Какую библиотеку визуализации использовать? ',
      reason: 'От ответа зависят практические задания.',
      options: ['matplotlib', 'plotly', 'matplotlib'],
      recommended: 'seaborn',
    },
    {
      label: 'На каких данных учиться?',
      reason: 'Данные определяют задачи семинаров.',
      options: ['Обезличенные данные банка', 'Открытые датасеты'],
      recommended: 'Открытые датасеты',
    },
  ]);
  assert.deepEqual(
    questions.map((q) => [q.id, q.label, q.options, q.recommended]),
    [
      [
        'model-1',
        'Какую библиотеку визуализации использовать?',
        ['matplotlib', 'plotly'],
        'matplotlib',
      ],
      [
        'model-2',
        'На каких данных учиться?',
        ['Обезличенные данные банка', 'Открытые датасеты'],
        'Открытые датасеты',
      ],
    ],
  );
});

test('лишние задачи и null в необязательных полях темы не ломают каркас', async () => {
  const answer = {
    goal: 'Цель',
    tasks: ['1', '2', '3', '4', '5', '6', '7'],
    outcomes: [outcome('Настраивает CI'), outcome('Пишет Terraform')],
    modules: [
      {
        title: 'CI/CD',
        topics: [
          { ...topic('GitLab CI', [1]), weight_reason: null, prerequisites: null },
          topic('Terraform', [2], [1]),
          topic('Мониторинг', [2], [2]),
        ],
      },
    ],
  };
  const gateway = {
    chat: async () => ({ content: JSON.stringify(answer), usage: {} as never }),
  };
  const { design } = await draftSkeleton(gateway as never, {
    request: 'DevOps на 36 часов',
    title: 'DevOps',
    template_id: 'acr_professional',
    audience: 'администраторы',
    entry_level: '',
    goal: '',
    total_hours: 36,
    delivery: '',
    assessment: '',
    constraints: '',
    answers: [],
  });
  assert.equal(design.tasks.length, 7);
  assert.equal(design.topics[0].weight_reason, '');
  assert.deepEqual(design.topics[0].prerequisites, []);
});

test('вопросы о полях сводки (аттестация, объём, форма обучения) отбрасываются', () => {
  const question = (label: string) => ({
    label,
    reason: 'Влияет на программу.',
    options: ['А', 'Б'],
    recommended: 'А',
  });
  const questions = normalizeQuestions([
    question(
      'Какой формат итоговой аттестации предпочтительнее: проектная работа или тестирование?',
    ),
    question('Сколько часов отвести на курс?'),
    question('Какую библиотеку машинного обучения использовать?'),
    question('Обучение очное или дистанционное?'),
    question('Какие источники данных использовать на практике?'),
  ]);
  assert.deepEqual(
    questions.map((q) => [q.id, q.label]),
    [
      ['model-1', 'Какую библиотеку машинного обучения использовать?'],
      ['model-2', 'Какие источники данных использовать на практике?'],
    ],
  );
});

test('пустой модуль итоговой аттестации от модели не отвергает каркас', async () => {
  const gateway = new LlmGateway({
    baseUrl: 'http://gateway.test',
    apiKey: 'test',
    dataDir: await mkdtemp(join(tmpdir(), 'courseos-')),
    fetch: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  goal: 'Цель',
                  tasks: ['Задача'],
                  outcomes: [outcome('Настраивает Linux'), outcome('Собирает CI/CD')],
                  modules: [
                    { title: 'Linux', topics: [topic('Права', [1]), topic('Сети', [1])] },
                    { title: 'CI/CD', topics: [topic('Пайплайн', [2]), topic('Мониторинг', [2])] },
                    { title: 'Итоговая аттестация', topics: [] },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 100 },
        }),
      ),
  });
  const { design } = await draftSkeleton(gateway, {
    request: 'DevOps',
    title: 'DevOps',
    template_id: 'acr_professional',
    audience: '',
    entry_level: '',
    goal: '',
    total_hours: 24,
    delivery: '',
    assessment: '',
    constraints: '',
    answers: [],
  });
  assert.deepEqual(design.module_titles, ['Linux', 'CI/CD']);
});

test('код сообщает, если результатов или знаний мало для объёма', () => {
  assert.deepEqual(outcomeRange(16), { min: 3, max: 4, knowledge: 1 });
  assert.deepEqual(outcomeRange(256), { min: 6, max: 10, knowledge: 3 });
  const { issues } = normalizeDesign(
    {
      goal: 'Цель',
      tasks: ['Задача'],
      design_notes: null,
      outcomes: [outcome('Первый'), outcome('Второй')],
      modules: [{ title: 'Модуль', topics: [topic('А', [1]), topic('Б', [2]), topic('В', [2])] }],
    },
    150,
  );
  assert.ok(issues.some((issue) => issue.includes('Результатов обучения 2, для 150 ч обычно 5–9')));
  assert.ok(issues.some((issue) => issue.includes('Результатов-знаний 0')));
});
