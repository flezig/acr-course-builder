import type { z } from 'zod';
import type { CallUsage, ChatMessage, LlmGateway } from '../llm/gateway.ts';
import { LlmError } from '../llm/gateway.ts';
import type { StepId } from '../llm/models.ts';
import { extractJson } from './parse-request.ts';

// Даже со схемой ответа GigaChat-3-Pro изредка «залипает» на пробелах до max_tokens,
// и JSON обрывается. Такой ответ повторяется один раз с другим seed: тело запроса
// меняется, поэтому кэш не вернёт тот же обрыв. Расход обеих попыток суммируется.
export async function chatStructured<T>(
  gateway: LlmGateway,
  step: StepId,
  messages: ChatMessage[],
  jsonSchema: { name: string; schema: object },
  schema: z.ZodType<T>,
  failure: string,
): Promise<{ data: T; usage: CallUsage }> {
  let spent: CallUsage | null = null;
  for (const seed of [undefined, 1]) {
    const { content, usage } = await gateway.chat(step, messages, { jsonSchema, seed });
    spent = spent
      ? {
          ...usage,
          prompt_tokens: spent.prompt_tokens + usage.prompt_tokens,
          completion_tokens: spent.completion_tokens + usage.completion_tokens,
          cost_rub: spent.cost_rub + usage.cost_rub,
          duration_ms: spent.duration_ms + usage.duration_ms,
          cached: spent.cached && usage.cached,
        }
      : usage;
    const parsed = schema.safeParse(extractJson(content));
    if (parsed.success) return { data: parsed.data, usage: spent };
  }
  throw new LlmError('empty', failure);
}
