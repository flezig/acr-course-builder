import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError } from '../../shared/api/http';

// Разбор запроса моделью живёт на сервере CourseOS отдельно от CourseApi:
// он только предлагает значения сводки, а курс по-прежнему создаёт выбранный адаптер.
const statusSchema = z.object({ available: z.boolean() });

export const callUsageSchema = z.object({
  model: z.string(),
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  cost_rub: z.number(),
  duration_ms: z.number(),
  cached: z.boolean(),
});

const analysisSchema = z.object({
  parameters: z.object({
    title: z.string(),
    template_id: z.enum(['acr_general', 'acr_professional', 'unknown']),
    audience: z.string(),
    entry_level: z.string(),
    goal: z.string(),
    total_hours: z.string(),
    delivery: z.string(),
    assessment: z.string(),
    constraints: z.string(),
    weeks: z.number().nullable(),
    daily_limit: z.string(),
    missing: z.array(z.string()),
  }),
  corrections: z.array(z.string()),
  usage: callUsageSchema,
});

export type RequestAnalysis = z.infer<typeof analysisSchema>;
export type CallUsage = z.infer<typeof callUsageSchema>;

async function postJson<T>(path: string, body: unknown, schema: z.ZodType<T>) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Сервер сам ждёт модель до 2 минут и повторяет запрос после сбоя.
      signal: AbortSignal.timeout(150_000),
    });
  } catch {
    throw new ApiError(0, 'Сервер CourseOS недоступен. Заполните сводку вручную.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      z.object({ detail: z.string() }).safeParse(payload).data?.detail ??
        'Не удалось разобрать запрос. Заполните сводку вручную.',
    );
  return schema.parse(payload);
}

export function useModelAvailability() {
  return useQuery({
    queryKey: ['llm-status'],
    // Без сервера (например, при npm run dev без backend) кнопка разбора просто не показывается.
    queryFn: async () => {
      const response = await fetch('/api/llm/status').catch(() => null);
      const parsed = statusSchema.safeParse(await response?.json().catch(() => null));
      return parsed.success && parsed.data.available;
    },
    staleTime: Infinity,
    retry: false,
  });
}

export function useRequestAnalysis() {
  return useMutation({
    mutationFn: (request: string) =>
      postJson('/api/llm/parse-request', { request }, analysisSchema),
    retry: false,
  });
}

const rubles = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const integers = new Intl.NumberFormat('ru-RU');

export function describeUsage(usage: CallUsage) {
  const model = usage.model.split('/').pop();
  const tokens = `${integers.format(usage.prompt_tokens + usage.completion_tokens)} токенов`;
  if (usage.cached) return `${model} · ${tokens} · повтор из сохранённого ответа, без оплаты`;
  return `${model} · ${tokens} · ${rubles.format(usage.duration_ms / 1000)} с · ${rubles.format(usage.cost_rub)} ₽`;
}
