import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmError, LlmGateway } from '../src/llm/gateway.ts';

function completion(content: string | null, prompt = 1000, output = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: prompt, completion_tokens: output },
    }),
    { status: 200 },
  );
}

async function gatewayWith(fetchImpl: typeof fetch) {
  return new LlmGateway({
    baseUrl: 'http://gateway.test',
    apiKey: 'test',
    dataDir: await mkdtemp(join(tmpdir(), 'courseos-')),
    fetch: fetchImpl,
    retryDelaysMs: [0, 0],
  });
}

test('считает стоимость и не оплачивает одинаковый запрос дважды', async () => {
  let calls = 0;
  const gateway = await gatewayWith(async () => {
    calls++;
    return completion('{"ok":true}');
  });
  const first = await gateway.chat('parse_request', [{ role: 'user', content: 'a' }]);
  const second = await gateway.chat('parse_request', [{ role: 'user', content: 'a' }]);
  assert.equal(calls, 1);
  // 1000 × 73,03 + 200 × 176,39 за миллион токенов.
  assert.equal(first.usage.cost_rub.toFixed(4), '0.1083');
  assert.equal(second.usage.cached, true);
  assert.equal(second.usage.cost_rub, 0);
  const log = await gateway.readLog();
  assert.deepEqual(
    log.map((entry) => [entry.status, entry.cached]),
    [
      ['ok', false],
      ['ok', true],
    ],
  );
});

test('повторяет запрос после 429 и сдаётся после исчерпания попыток', async () => {
  let calls = 0;
  const flaky = await gatewayWith(async () =>
    ++calls === 1 ? new Response('', { status: 429 }) : completion('ответ'),
  );
  assert.equal(
    (await flaky.chat('parse_request', [{ role: 'user', content: 'b' }])).content,
    'ответ',
  );

  const limited = await gatewayWith(async () => new Response('', { status: 429 }));
  await assert.rejects(
    limited.chat('parse_request', [{ role: 'user', content: 'c' }]),
    (error) => error instanceof LlmError && error.code === 'rate_limited',
  );
  assert.equal((await limited.readLog())[0].status, 'error');
});

test('пустой ответ модели — ошибка, а не успешный результат', async () => {
  const gateway = await gatewayWith(async () => completion(null));
  await assert.rejects(
    gateway.chat('parse_request', [{ role: 'user', content: 'd' }]),
    (error) => error instanceof LlmError && error.code === 'empty',
  );
});

test('держит не больше двух одновременных запросов', async () => {
  let active = 0;
  let peak = 0;
  const gateway = await gatewayWith(async () => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return completion('ответ');
  });
  await Promise.all(
    ['1', '2', '3', '4', '5'].map((content) =>
      gateway.chat('parse_request', [{ role: 'user', content }]),
    ),
  );
  assert.equal(peak, 2);
});

test('без адреса и ключа модель недоступна', async () => {
  const gateway = new LlmGateway({ baseUrl: undefined, apiKey: undefined, dataDir: tmpdir() });
  assert.equal(gateway.available, false);
  await assert.rejects(
    gateway.chat('parse_request', []),
    (error) => error instanceof LlmError && error.code === 'unavailable',
  );
});
