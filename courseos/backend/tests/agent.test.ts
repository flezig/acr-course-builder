import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AgentRunner,
  agentRequestSchema,
  findingReviewSchema,
  summaryGaps,
} from '../src/agent/run-agent.ts';
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

async function runner(
  options: {
    dataDir?: string;
    onRequest?: (system: string, user: string) => void | Promise<void>;
  } = {},
) {
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'courseos-agent-')));
  const gateway = new LlmGateway({
    baseUrl: 'http://gateway.test',
    apiKey: 'test',
    dataDir,
    retryDelaysMs: [],
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init!.body));
      await options.onRequest?.(body.messages[0].content, body.messages[1].content);
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
  assert.equal(view.approval.human_approved, false);
  assert.ok(['succeeded', 'needs_review'].includes(view.status), view.status);
  assert.deepEqual([...new Set(view.events.map((e: { step: string }) => e.step))].slice(0, 6), [
    'parse_request',
    'clarify_questions',
    'draft_skeleton',
    'skeleton',
    'automatic_approval',
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
  assert.equal(course.status.approved, false);
  assert.equal(course.approvals.at(-1).kind, 'automatic');
  assert.equal(course.approvals.at(-1).actor_id, 'automatic-api');
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

function reviewedVersion(view: Record<string, any>) {
  return {
    skeleton_version: view.skeleton.version,
    skeleton_hash: view.skeleton.hash,
    course_version: view.skeleton.course_version,
  };
}

test('после перезапуска ждёт методиста и сохраняет решения по каркасу', { skip }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'courseos-restart-'));
  let agent = await runner({ dataDir });
  let run = await agent.start(
    agentRequestSchema.parse({ request: 'Программа на 72 часа, очно-заочно' }),
  );
  let view = agent.view(run) as Record<string, any>;
  assert.equal(run.status, 'awaiting_approval');
  assert.equal(run.calls.length, 3);
  assert.equal(view.approval.human_approved, false);
  assert.equal(view.files, undefined);
  const initialSkeleton = structuredClone(view.skeleton);
  agent = await runner({ dataDir });
  run = (await agent.get(run.run_id))!;
  await assert.rejects(
    agent.review(run.run_id, {
      ...reviewedVersion(view),
      decision: { action: 'apply_finding', issue_id: 'missing' },
    }),
    /нет предложения/,
  );
  assert.equal(run.status, 'awaiting_approval');
  assert.deepEqual((agent.view(run) as any).skeleton, initialSkeleton);
  assert.ok(initialSkeleton.audit_issues.some((i: any) => i.blocking));
  assert.equal(
    await agent.approve(run.run_id, { ...reviewedVersion(view), skeleton_hash: 'stale' }),
    null,
  );
  await agent.approve(run.run_id, reviewedVersion(view));
  view = agent.view(run) as Record<string, any>;
  assert.equal(run.status, 'awaiting_approval');
  assert.deepEqual(view.skeleton, initialSkeleton);
  assert.deepEqual(view.decisions, []);
  assert.equal(run.calls.length, 3);
  assert.ok(!view.events.some((e: any) => e.step === 'approval' || e.step === 'content'));

  // Каждое решение возвращает каркас для проверки, но не запускает материалы.
  for (let round = 0; round < 20; round++) {
    const issue = view.skeleton.audit_issues.find((i: any) => i.blocking);
    if (!issue) break;
    const review = reviewedVersion(view);
    const decision = issue.can_apply
      ? { action: 'apply_finding' as const, issue_id: issue.id }
      : {
          action: 'dismiss_finding' as const,
          issue_id: issue.id,
          reason: 'Проверено методистом для этой программы',
        };
    const [reviewed, duplicate] = await Promise.all([
      agent.review(run.run_id, { ...review, decision }),
      agent.review(run.run_id, { ...review, decision }),
    ]);
    assert.equal(duplicate, null);
    assert.ok(reviewed);
    view = agent.view(run) as Record<string, any>;
    assert.equal(view.status, 'awaiting_approval');
    assert.equal(view.files, undefined);
    assert.equal(run.calls.length, 3);
    assert.ok(view.skeleton.course_version > review.course_version);
    assert.equal(await agent.approve(run.run_id, review), null);
    agent = await runner({ dataDir });
    run = (await agent.get(run.run_id))!;
  }
  assert.ok(!view.skeleton.audit_issues.some((i: any) => i.blocking));
  const finalSkeleton = structuredClone(view.skeleton);
  const approved = await agent.approve(run.run_id, reviewedVersion(view));
  assert.ok(['succeeded', 'needs_review'].includes(approved!.status), approved!.status);
  view = agent.view(run) as Record<string, any>;
  assert.equal(view.approval.human_approved, true);
  assert.equal(view.skeleton.hash, finalSkeleton.hash);
  assert.equal(view.skeleton.version, finalSkeleton.version);
  assert.ok(view.decisions.length > 0);
  assert.ok(view.decisions.every((d: any) => d.actor === 'methodist-api'));
  const course = JSON.parse((await agent.file(run.run_id, 'course.json'))!.body.toString());
  assert.equal(course.status.approved, true);
  assert.equal(course.approvals.at(-1).actor_id, 'methodist-api');
  assert.equal(await agent.approve(run.run_id, reviewedVersion(view)), null);
});

test('отклонение замечания требует явной причины', () => {
  assert.equal(agentRequestSchema.parse({ request: 'Курс' }).approve, false);
  assert.equal(
    findingReviewSchema.safeParse({
      skeleton_version: 1,
      skeleton_hash: 'hash',
      course_version: 1,
      decision: { action: 'dismiss_finding', issue_id: 'issue', reason: ' ' },
    }).success,
    false,
  );
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

test('после сбоя темы и перезапуска повторяет только незавершённые запросы', { skip }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'courseos-partial-'));
  const topics = new Map<string, number>();
  let failedTopic = '';
  const onRequest = (system: string, user: string) => {
    if (!system.includes('содержание одной темы')) return;
    topics.set(user, (topics.get(user) ?? 0) + 1);
    if (!failedTopic) {
      failedTopic = user;
      throw new DOMException('timeout', 'TimeoutError');
    }
  };
  let agent = await runner({ dataDir, onRequest });
  const run = await agent.start(
    agentRequestSchema.parse({ request: 'Программа на 72 часа, очно-заочно', approve: true }),
  );
  let view = agent.view(run) as Record<string, any>;
  assert.equal(view.status, 'needs_review', view.error);
  assert.equal(view.generation.failed.length, 1);
  assert.match(view.generation.failed[0], /Тема.*2 минуты.*Готовые части сохранены/);
  const successful = [...topics.keys()].filter((prompt) => prompt !== failedTopic);
  assert.ok(successful.length > 0);
  agent = await runner({ dataDir, onRequest });
  const retried = await agent.retry(run.run_id);
  assert.ok(retried);
  view = agent.view(retried) as Record<string, any>;
  assert.equal(view.error, null);
  assert.deepEqual(view.generation.failed, []);
  assert.equal(topics.get(failedTopic), 2);
  for (const prompt of successful) assert.equal(topics.get(prompt), 1);
  assert.deepEqual(Object.keys(view.files).sort(), ['docx', 'json', 'lms', 'markdown', 'pptx']);
  assert.equal(view.approval.human_approved, false);
  assert.equal(await agent.retry(run.run_id), null);
});

test('ошибка сохранения одного запуска не останавливает следующий', { skip }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'courseos-storage-'));
  const failingAgent = await runner({ dataDir });
  // Проверяем также отказ до первого вызова модели и возможность повторить после восстановления.
  await writeFile(join(dataDir, 'runs'), 'storage unavailable');
  const failed = await failingAgent.start(
    agentRequestSchema.parse({ request: 'Программа на 72 часа, очно-заочно' }),
  );
  assert.equal(failed.status, 'failed');
  assert.equal((failingAgent.view(failed) as any).failure.code, 'storage');
  await rm(join(dataDir, 'runs'));
  const next = await failingAgent.start(
    agentRequestSchema.parse({ request: 'Программа на 72 часа, очно-заочно' }),
  );
  assert.equal(next.status, 'awaiting_approval', next.error ?? '');
  assert.equal((await failingAgent.retry(failed.run_id))?.status, 'awaiting_approval');
});

test(
  'таймаут разбора не останавливает очередь следующих сборок',
  { skip },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'courseos-queue-'));
    let fail = true;
    const agent = await runner({
      dataDir,
      onRequest: () => {
        if (fail) {
          fail = false;
          throw new DOMException('timeout', 'TimeoutError');
        }
      },
    });
    const request = agentRequestSchema.parse({ request: 'Программа на 72 часа, очно-заочно' });
    const first = await agent.start(request);
    assert.equal(first.status, 'failed');
    assert.equal((agent.view(first) as any).failure.code, 'timeout');
    assert.equal((agent.view(first) as any).failure.retryable, true);
    const second = await agent.start(request);
    assert.equal(second.status, 'awaiting_approval', second.error ?? '');
  },
);

test(
  'отказ записи контрольной точки внутри очереди не останавливает следующий запуск',
  { skip },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'courseos-save-queue-'));
    let block = true;
    let brokenFile = '';
    const agent = await runner({
      dataDir,
      onRequest: async () => {
        if (!block) return;
        block = false;
        const [id] = await readdir(join(dataDir, 'runs'));
        brokenFile = join(dataDir, 'runs', id, 'run.json');
        await rm(brokenFile);
        await mkdir(brokenFile);
      },
    });
    const request = agentRequestSchema.parse({ request: 'Программа на 72 часа, очно-заочно' });
    const failed = await agent.start(request);
    assert.equal(failed.status, 'failed');
    assert.equal((agent.view(failed) as any).failure.code, 'storage');
    const next = await agent.start(request);
    assert.equal(next.status, 'awaiting_approval', next.error ?? '');
    await rm(brokenFile, { recursive: true });
    const resumed = await agent.retry(failed.run_id);
    assert.equal(resumed?.status, 'awaiting_approval');
    assert.deepEqual((agent.view(resumed!) as any).skeleton, (agent.view(failed) as any).skeleton);
  },
);

test(
  'прерванный запуск после перезапуска получает понятный статус и восстанавливает выгрузки',
  { skip },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'courseos-interrupted-'));
    let calls = 0;
    let agent = await runner({
      dataDir,
      onRequest: () => {
        calls++;
      },
    });
    const run = await agent.start(
      agentRequestSchema.parse({ request: 'Программа на 72 часа, очно-заочно', approve: true }),
    );
    const path = join(dataDir, 'runs', run.run_id, 'run.json');
    const state = JSON.parse(await readFile(path, 'utf8'));
    state.status = 'running';
    state.phase = 'content';
    await writeFile(path, JSON.stringify(state));
    const before = calls;
    agent = await runner({
      dataDir,
      onRequest: () => {
        calls++;
      },
    });
    const interrupted = await agent.get(run.run_id);
    assert.equal(interrupted?.status, 'failed');
    assert.equal((agent.view(interrupted!) as any).failure.code, 'interrupted');
    const resumed = await agent.retry(run.run_id);
    assert.equal(resumed?.error, null);
    assert.equal(calls, before);
    assert.ok(await agent.file(run.run_id, 'program.docx'));
    assert.equal((agent.view(resumed!) as any).approval.human_approved, false);
  },
);
