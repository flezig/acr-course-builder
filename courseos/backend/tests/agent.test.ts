import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AgentRunner, summaryGaps } from '../src/agent/run-agent.ts';
import { LlmGateway } from '../src/llm/gateway.ts';

const bundle = resolve(import.meta.dirname, '../../frontend/dist-agent/headless.js');

// Ответ поддельного шлюза выбирается по системному промпту шага.
function answer(system: string, user: string): object {
  if (system.includes('сводку параметров'))
    return user.includes('примерно на месяц') && !user.includes('Ответы методиста')
      ? {
          title: 'Кибербезопасность',
          template_id: 'unknown',
          audience: 'Студенты колледжа',
          entry_level: '',
          goal: 'Подготовить к работе',
          total_hours: '',
          delivery: '',
          assessment: '',
          constraints: '',
          weeks: 4,
          daily_limit: '',
          missing: [],
        }
      : {
          title: 'Анализ данных на Python',
          template_id: 'acr_professional',
          audience: 'Сотрудники банков',
          entry_level: 'Excel',
          goal: 'Анализировать данные',
          total_hours: '72',
          delivery: 'Очно-заочная',
          assessment: 'Защита итогового проекта',
          constraints: '',
          weeks: 4,
          daily_limit: '4',
          missing: [],
        };
  if (system.includes('ты задаёшь методисту уточняющие вопросы'))
    return {
      questions: [
        {
          label: 'На каких данных учиться?',
          reason: 'Задания',
          options: ['Кредиты', 'Вклады'],
          recommended: 'Кредиты',
        },
      ],
    };
  if (system.includes('Спроектируй каркас')) {
    const topic = (title: string, outcomes: number[]) => ({
      title,
      content: title,
      profile: 'tool',
      weight: 3,
      weight_reason: '',
      outcomes,
      prerequisites: [],
      control: 'Практикум',
    });
    return {
      goal: 'Анализировать данные',
      tasks: ['Освоить pandas'],
      outcomes: [1, 2, 3].map((n) => ({
        kind: 'skill',
        title: `РО ${n}`,
        description: `Умеет ${n}`,
        criteria: ['Делает'],
      })),
      modules: [
        { title: 'Python', topics: [topic('Синтаксис', [1]), topic('Функции', [1])] },
        {
          title: 'pandas',
          topics: [topic('Очистка', [2]), topic('Объединение', [2]), topic('Группировка', [2])],
        },
        { title: 'SQL', topics: [topic('SELECT', [3]), topic('JOIN', [3]), topic('Отчёт', [3])] },
      ],
    };
  }
  if (system.includes('содержание одной темы'))
    return {
      lecture_points: ['Пункт'],
      practice: { title: 'Практикум «Тема»', points: ['Действие'] },
      self_study_points: ['Повторить'],
      slides: [{ title: 'Слайд', bullets: ['Тезис'], notes: 'Заметка' }],
      seminar: {
        title: 'Задание',
        task: 'Условие',
        steps: ['Шаг'],
        expected: 'Файл',
        criteria: ['Верно'],
      },
      control_questions: ['Вопрос?'],
    };
  if (system.includes('итоговый тест'))
    return {
      questions: Array.from({ length: 10 }, (_, i) => ({
        text: `Вопрос ${i + 1}`,
        options: ['а', 'б', 'в', 'г'],
        correct: (i % 4) + 1,
        explanation: 'Так',
        outcome: `РО ${(i % 3) + 1}`,
      })),
    };
  if (system.includes('итоговой аттестации'))
    return {
      title: 'Защита проекта',
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
    };
  if (system.includes('текстовые разделы программы'))
    return {
      relevance: 'Нужна',
      methodical: 'Практика',
      organization: 'Очно-заочно',
      environment: ['Python 3.12'],
      literature: [{ group: 'main', citation: 'Книга' }],
    };
  if (system.includes('Исправь вопросы итогового теста')) return { questions: [] };
  if (system.includes('эксперт-методист'))
    return {
      issues: [
        { severity: 'warning', element: 'Вопрос 2', message: 'Неоднозначно', fix: 'Уточнить' },
      ],
      summary: 'Согласовано',
    };
  throw new Error(`Неизвестный шаг: ${system.slice(0, 80)}`);
}

async function runner() {
  const dataDir = await mkdtemp(join(tmpdir(), 'courseos-agent-'));
  const gateway = new LlmGateway({
    baseUrl: 'http://gateway.test',
    apiKey: 'test',
    dataDir,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init!.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(answer(body.messages[0].content, body.messages[1].content)),
              },
            },
          ],
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        }),
      );
    },
  });
  return new AgentRunner(gateway, dataDir, bundle);
}

const skip = !existsSync(bundle) && 'нужна сборка движка: npm run build:agent во frontend';

test('один вызов проводит запрос через все шаги и отдаёт файлы', { skip }, async () => {
  const agent = await runner();
  const run = await agent.start({
    request: 'Программа на 72 часа по анализу данных, очно-заочно',
    clarifications: '',
    answers: {},
    approve: true,
    wait: true,
  });
  const view = agent.view(run) as Record<string, any>;
  assert.equal(view.error, null);
  assert.ok(['succeeded', 'needs_review'].includes(view.status), view.status);
  assert.deepEqual([...new Set(view.events.map((e: { step: string }) => e.step))].slice(0, 6), [
    'parse_request',
    'clarify_questions',
    'draft_skeleton',
    'skeleton',
    'approval',
    'content',
  ]);
  const total = view.skeleton.curriculum.reduce(
    (sum: number, row: { total: string }) => sum + Number(row.total),
    0,
  );
  assert.equal(total, 72);
  assert.equal(view.content_questions[0].answered_by, 'agent_recommendation');
  assert.deepEqual(Object.keys(view.files).sort(), ['docx', 'json', 'lms', 'markdown', 'pptx']);
  for (const name of ['program.docx', 'slides.pptx', 'test-moodle.xml', 'course.json'])
    assert.ok(await agent.file(run.run_id, name), name);
  const course = JSON.parse((await agent.file(run.run_id, 'course.json'))!.body.toString());
  assert.equal(
    course.materials.find((m: { type: string }) => m.type === 'test').questions.length,
    10,
  );
  assert.equal(course.generation.review.issues.length, 1);
  const literature = course.sections.find(
    (s: { title: string }) => s.title === '3.2.2 Основная литература',
  );
  assert.match(literature.content, /\[НЕ ПОДТВЕРЖДЁН\] Книга/);
  assert.ok(view.usage.cost_rub > 0);
});

test('неполный запрос возвращает вопросы методисту, а не программу', { skip }, async () => {
  const agent = await runner();
  const run = await agent.start({
    request: 'Курс по кибербезопасности, примерно на месяц',
    clarifications: '',
    answers: {},
    approve: true,
    wait: true,
  });
  const view = agent.view(run) as Record<string, any>;
  assert.equal(view.status, 'awaiting_clarification', view.error);
  assert.ok(view.questions.length >= 4 && view.questions.length <= 5, view.questions.join('\n'));
  assert.equal(view.skeleton, undefined);
});

test('без утверждения сборка останавливается на каркасе', { skip }, async () => {
  const agent = await runner();
  const run = await agent.start({
    request: 'Программа на 72 часа, очно-заочно',
    clarifications: '',
    answers: {},
    approve: false,
    wait: true,
  });
  assert.equal(run.status, 'awaiting_approval');
  const approved = await agent.approve(run.run_id);
  assert.ok(['succeeded', 'needs_review'].includes(approved!.status), approved!.status);
});

test('агент спрашивает тип и объём всегда, а одно второстепенное поле берёт допущением', () => {
  const base = {
    title: 'DevOps',
    template_id: 'acr_professional' as const,
    audience: 'Специалисты',
    entry_level: '',
    goal: 'DevOps',
    total_hours: '256',
    delivery: 'Стажировка',
    assessment: 'Защита отчёта',
    constraints: '',
    weeks: 8,
    daily_limit: '4',
    missing: [],
  };
  const one = summaryGaps(base);
  assert.deepEqual(one.questions, []);
  assert.match(one.assumed.entry_level!, /уточняет методист/);
  assert.equal(summaryGaps({ ...base, delivery: '' }).questions.length, 2);
  assert.deepEqual(summaryGaps({ ...base, total_hours: '' }).questions, [
    'Какой объём программы в академических часах (16–500)?',
    'Какой входной уровень подготовки у слушателей?',
  ]);
});
