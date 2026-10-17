import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError } from '../../shared/api/http';
import {
  clarifyingQuestionSchema,
  modelDesignSchema,
  type ClarifyingQuestion,
  type ModelDesign,
  type Requirements,
} from '../../entities/course/model/schema';

// Шаги с моделью живут на сервере CourseOS отдельно от CourseApi: они только предлагают
// значения сводки и структуру каркаса, а курс по-прежнему создаёт выбранный адаптер.
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
    throw new ApiError(0, 'Сервер CourseOS недоступен или модель не ответила вовремя.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      z.object({ detail: z.string() }).safeParse(payload).data?.detail ??
        'Модель не справилась с запросом. Повторите или продолжите без неё.',
    );
  return schema.parse(payload);
}

const skeletonDraftSchema = z.object({
  design: modelDesignSchema.omit({ issues: true }),
  issues: z.array(z.string()),
});

// Сводка, которую видят шаги модели: поля, подтверждённые методистом, без служебных данных курса.
function summaryFields(requirements: Requirements) {
  return {
    request: requirements.request,
    title: requirements.title,
    template_id: requirements.template_id,
    audience: requirements.audience,
    entry_level: requirements.entry_level,
    goal: requirements.goal,
    total_hours: requirements.total_hours,
    delivery: requirements.delivery,
    assessment: requirements.assessment,
    constraints: requirements.constraints,
  };
}

export function useClarifyingQuestions() {
  return useMutation({
    mutationFn: async (requirements: Requirements): Promise<ClarifyingQuestion[]> =>
      (
        await postJson(
          '/api/llm/clarify-questions',
          summaryFields(requirements),
          z.object({ questions: z.array(clarifyingQuestionSchema) }),
        )
      ).questions,
    retry: false,
  });
}

export function useSkeletonDraft() {
  return useMutation({
    mutationFn: async (requirements: Requirements): Promise<ModelDesign> => {
      const { design, issues } = await postJson(
        '/api/llm/draft-skeleton',
        {
          ...summaryFields(requirements),
          references: requirements.references.map((source) => ({
            id: source.id,
            name: source.name,
            text: source.text.slice(0, 12000),
            url: source.url,
          })),
          answers: (requirements.model_questions ?? []).flatMap((question) => {
            const answer = requirements.clarification_answers?.[question.id]?.trim();
            return answer ? [{ question: question.label, answer }] : [];
          }),
        },
        skeletonDraftSchema,
      );
      return { ...design, issues };
    },
    retry: false,
  });
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
