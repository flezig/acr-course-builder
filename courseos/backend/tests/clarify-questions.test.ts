import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmGateway } from '../src/llm/gateway.ts';
import { clarifyQuestions, questionsInputSchema } from '../src/steps/clarify-questions.ts';

test('пропущенная рекомендация не теряет вопросы и предлагает существующий вариант', async () => {
  const gateway = new LlmGateway({
    baseUrl: 'http://gateway.test',
    apiKey: 'test',
    dataDir: await mkdtemp(join(tmpdir(), 'courseos-questions-')),
    fetch: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  questions: [
                    {
                      label: 'Какие данные?',
                      reason: 'Определяет практику',
                      options: ['С ошибками', 'Чистые'],
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 100 },
        }),
      ),
  });
  const input = questionsInputSchema.parse({
    request: 'Анализ транзакций',
    title: 'Python',
    template_id: 'acr_professional',
    audience: 'Аналитики',
    entry_level: 'Excel',
    goal: 'Анализировать',
    total_hours: '72',
    delivery: 'Очно',
    assessment: 'Проект',
    constraints: 'Синтетические данные',
  });
  const result = await clarifyQuestions(gateway, input);
  assert.equal(result.questions[0].recommended, 'С ошибками');
  assert.equal(result.usage.cached, false);
});
