import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAgainstText,
  normalize,
  extractJson,
  parseRequest,
  parsedRequestSchema,
  type ParsedRequest,
} from '../src/steps/parse-request.ts';
import { usageSummary } from '../src/usage.ts';

const parameters: ParsedRequest = {
  title: 'Анализ данных на Python',
  template_id: 'acr_professional',
  audience: 'сотрудники банков',
  entry_level: '',
  goal: '',
  total_hours: '80',
  delivery: 'очно-заочная',
  assessment: 'защита проекта',
  constraints: '',
  weeks: null,
  daily_limit: '',
  missing: [],
};

test('достаёт JSON из ответа с пояснением и блоком кода', () => {
  assert.deepEqual(extractJson('Вот параметры:\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.equal(extractJson('без json'), null);
});

test('объём из текста запроса важнее ответа модели', () => {
  const result = checkAgainstText(
    parameters,
    'Программа на 72 часа очно-заочно, до 4 часов в день',
  );
  assert.equal(result.parameters.total_hours, '72');
  assert.equal(result.corrections.length, 1);
});

test('при нескольких разных объёмах в тексте ответ модели не правится', () => {
  const result = checkAgainstText(
    parameters,
    'Очно-заочная программа: было 72 часа, нужно сократить до 36 часов',
  );
  assert.equal(result.parameters.total_hours, '80');
  assert.deepEqual(result.corrections, []);
});

test('сводка расхода учитывает только московские сутки', () => {
  const entry = {
    step: 'parse_request' as const,
    model: 'GigaChat/GigaChat-3-Pro' as const,
    prompt_tokens: 1000,
    completion_tokens: 200,
    cost_rub: 0.11,
    duration_ms: 2000,
    cached: false,
    status: 'ok' as const,
  };
  const summary = usageSummary(
    [
      { ...entry, at: '2026-10-16T20:59:00Z' },
      { ...entry, at: '2026-10-16T21:01:00Z' },
    ],
    new Date('2026-10-17T10:00:00Z'),
  );
  assert.equal(summary.calls, 1);
  assert.equal(summary.cost_rub, 0.11);
  assert.equal(summary.by_step.parse_request.tokens, 1200);
});

test('заглушки модели вроде «неизвестно» превращаются в пустые поля', async () => {
  const gateway = {
    chat: async () => ({
      content: JSON.stringify({ ...parameters, entry_level: 'неизвестно', total_hours: 72 }),
      usage: {} as never,
    }),
  };
  const result = await parseRequest(gateway as never, 'Курс для аналитиков');
  assert.equal(result.parameters.entry_level, '');
  assert.equal(result.parameters.total_hours, '72');
});

test('форма обучения, которой нет в тексте, не попадает в сводку', () => {
  const invented = checkAgainstText(
    { ...parameters, delivery: 'очная' },
    'Курс DevOps на 36 часов',
  );
  assert.equal(invented.parameters.delivery, '');
  assert.ok(invented.parameters.missing.length);
  const stated = checkAgainstText(parameters, 'Курс на 80 часов, очно-заочная форма');
  assert.equal(stated.parameters.delivery, 'очно-заочная');
  const adverb = checkAgainstText(
    { ...parameters, delivery: 'очная' },
    'Интенсив на 80 часов, очно',
  );
  assert.equal(adverb.parameters.delivery, 'очная');
});

test('null от модели становится пустым полем, а «по 2 часа» — не объёмом курса', async () => {
  const gateway = {
    chat: async () => ({
      content: JSON.stringify({
        ...parameters,
        total_hours: '12',
        delivery: null,
        assessment: null,
        missing: null,
      }),
      usage: {} as never,
    }),
  };
  const result = await parseRequest(
    gateway as never,
    'Интенсив «ML за 2 недели», занятия 3 раза в неделю по 2 часа',
  );
  assert.equal(result.parameters.delivery, '');
  assert.equal(result.parameters.assessment, '');
  assert.deepEqual(result.parameters.missing, []);
  assert.equal(result.parameters.total_hours, '12');
});

test('объём по расписанию считает код, а не модель', () => {
  const result = checkAgainstText(
    { ...parameters, total_hours: '36', delivery: '', weeks: 2 },
    'Интенсив «ML за 2 недели», занятия 3 раза в неделю по 3 часа',
  );
  assert.equal(result.parameters.total_hours, '18');
  assert.match(result.corrections[0], /3 × 3 ч × 2 нед\. = 18 ч/);
});

test('стажировка из текста запроса попадает в форму обучения', () => {
  const result = checkAgainstText(
    {
      ...parameters,
      total_hours: '256',
      delivery: 'самостоятельная работа в ИТ-компании с наставником',
    },
    'Программа повышения квалификации в форме стажировки на 256 часов, работа самостоятельная под руководством наставника',
  );
  assert.equal(
    result.parameters.delivery,
    'Стажировка: самостоятельная работа в ИТ-компании с наставником',
  );
  assert.deepEqual(result.corrections, [
    'Форма обучения дополнена: «Стажировка: самостоятельная работа в ИТ-компании с наставником» — в запросе указана стажировка.',
  ]);
});

test('«unknown» в полях сводки становится пустым полем, а тип программы остаётся', () => {
  const record = normalize({
    template_id: 'unknown',
    entry_level: 'unknown',
    assessment: 'Unknown',
  }) as Record<string, unknown>;
  assert.equal(record.template_id, 'unknown');
  assert.equal(record.entry_level, '');
  assert.equal(record.assessment, '');
});

test('пропущенные моделью поля считаются пустыми, а не ломают разбор', () => {
  // Реальный ответ GigaChat-3-Pro на запрос из README: без поля missing, недели строкой.
  const content =
    '{"title": "Анализ данных на Python", "template_id": "acr_professional", "audience": "сотрудники банков", "entry_level": "", "goal": "научить анализировать данные", "total_hours": "72", "delivery": "очно-заочная", "assessment": "защита проекта", "constraints": "", "weeks": "4", "daily_limit": ""}';
  const parsed = parsedRequestSchema.parse(normalize(extractJson(content)));
  assert.deepEqual(parsed.missing, []);
  assert.equal(parsed.weeks, 4);
});
