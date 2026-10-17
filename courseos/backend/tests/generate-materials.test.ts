import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmGateway } from '../src/llm/gateway.ts';
import {
  generateFinalAssessment,
  generateTopicMaterials,
  normalizeQuestions,
} from '../src/steps/generate-materials.ts';

async function answering(content: object) {
  return new LlmGateway({
    baseUrl: 'http://gateway.test',
    apiKey: 'test',
    dataDir: await mkdtemp(join(tmpdir(), 'courseos-')),
    fetch: async () =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: `Вот ответ:\n\`\`\`json\n${JSON.stringify(content)}\n\`\`\`` } },
          ],
          usage: { prompt_tokens: 1500, completion_tokens: 1200 },
        }),
      ),
  });
}

const brief = {
  title: 'Анализ данных',
  template_id: 'acr_professional' as const,
  audience: 'Сотрудники банков',
  entry_level: 'Excel',
  goal: 'Анализировать данные',
  delivery: 'Очно',
  assessment: 'Защита проекта',
  internship: false,
  constraints: '',
  references: [],
  outcomes: [
    { code: 'РО 1', kind: 'skill', description: 'Очищает данные' },
    { code: 'РО 2', kind: 'skill', description: 'Строит отчёт' },
  ],
  answers: [],
};

const question = (correct: number, outcome = 'РО 1', options = ['а', 'б', 'в', 'г']) => ({
  text: 'Вопрос',
  options,
  correct,
  explanation: 'Объяснение',
  outcome,
});

test('тест: код отбрасывает неверные ключи, повторы вариантов и чужие результаты', () => {
  const { questions, issues } = normalizeQuestions(
    [
      question(2),
      question(5),
      question(1, 'РО 1', ['а', 'А', 'в', 'г']),
      question(1, 'РО 9'),
      question(4, 'Результат РО 2'),
    ],
    ['РО 1', 'РО 2'],
    2,
  );
  assert.deepEqual(
    questions.map((q) => [q.correct_index, q.outcome_code]),
    [
      [1, 'РО 1'],
      [3, 'РО 2'],
    ],
  );
  assert.equal(issues.length, 3);
});

test('тест: сообщает о результате без вопросов и о нехватке вопросов', () => {
  const { issues } = normalizeQuestions([question(1)], ['РО 1', 'РО 2'], 10);
  assert.deepEqual(issues, [
    'В тесте 1 вопросов из 10; недостающие добавьте вручную.',
    'Результат РО 2 не проверяется ни одним вопросом теста.',
  ]);
});

test('тема без лекций не получает слайдов и пунктов лекции', async () => {
  const gateway = await answering({
    lecture_points: ['Лишний пункт'],
    practice: { title: 'Практикум «Очистка»', points: ['Удалить дубли'] },
    self_study_points: [],
    slides: [{ title: 'Слайд', bullets: ['Тезис'], notes: '' }],
    seminar: {
      title: 'Очистка',
      task: 'Дано',
      steps: ['Шаг'],
      expected: 'Файл',
      criteria: ['Нет дублей'],
    },
    control_questions: null,
  });
  const { materials, usage } = await generateTopicMaterials(gateway, {
    brief,
    module_title: 'Основы',
    topic: {
      id: 'topic-1',
      number: '1.1',
      title: 'Очистка',
      content: 'Дубли',
      hours: { lecture: 0, practice: 4, lab: 0, self_study: 2 },
      outcome_codes: ['РО 1'],
      control: 'Практикум',
    },
    previous_topics: [],
  });
  assert.deepEqual(materials.lecture_points, []);
  assert.deepEqual(materials.slides, []);
  assert.deepEqual(materials.control_questions, []);
  assert.equal(materials.practice?.title, 'Практикум «Очистка»');
  assert.equal(usage.step, 'topic_materials');
});

test('аттестация: баллы критериев приводятся к 100, порог — к разумному', async () => {
  const gateway = await answering({
    title: 'Защита',
    description: 'Отчёт',
    requirements: ['Ноутбук', 'Записка'],
    example_task: 'Отток',
    criteria: [
      { name: 'Корректность', max_points: 30, levels: '…' },
      { name: 'Выводы', max_points: 30, levels: '…' },
    ],
    pass_threshold: 100,
    procedure: ['Доклад'],
    interview_questions: [],
  });
  const { final, issues } = await generateFinalAssessment(gateway, {
    brief,
    modules: [{ title: 'Основы', topics: ['Очистка'] }],
  });
  assert.deepEqual(
    final.criteria.map((c) => c.max_points),
    [50, 50],
  );
  assert.equal(final.pass_threshold, 70);
  assert.equal(issues.length, 2);
});

test('оборванный JSON повторяется один раз с другим seed, расход суммируется', async () => {
  const seeds: unknown[] = [];
  const gateway = new LlmGateway({
    baseUrl: 'http://gateway.test',
    apiKey: 'test',
    dataDir: await mkdtemp(join(tmpdir(), 'courseos-')),
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init!.body));
      seeds.push(body.seed);
      const content = body.seed
        ? JSON.stringify({
            title: 'Защита',
            description: 'Отчёт',
            requirements: ['Ноутбук', 'Записка'],
            example_task: 'Отток',
            criteria: [
              { name: 'Данные', max_points: 50, levels: '…' },
              { name: 'Выводы', max_points: 50, levels: '…' },
            ],
            pass_threshold: 70,
            procedure: ['Доклад'],
            interview_questions: [],
          })
        : '{"title": "Защита", "description": "Отчёт"' + ' '.repeat(50);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 1000, completion_tokens: 1000 },
        }),
      );
    },
  });
  const { final, usage } = await generateFinalAssessment(gateway, {
    brief,
    modules: [{ title: 'Основы', topics: ['Очистка'] }],
  });
  assert.deepEqual(seeds, [undefined, 1]);
  assert.equal(final.title, 'Защита');
  assert.equal(usage.prompt_tokens, 2000);
});
