// Для кейса GigaCowork шлюз хакатона открывает только эти модели.
// Цены — рубли за 1 млн токенов из карточки «LLM для команды» на 17.10.2026;
// выход рассуждающей модели включает токены рассуждения.
export const models = {
  'GigaChat/GigaChat-3-Pro': { input: 73.03, output: 176.39 },
  'ai-sage/GigaChat3.5-432B-A28B-Reasoning': { input: 96.22, output: 288.6 },
} as const;

export type ModelId = keyof typeof models;

export interface StepRoute {
  model: ModelId;
  temperature: number;
  maxTokens: number;
}

// Модель и параметры выбираются под шаг агента, а не одна на всё приложение:
// извлечение полей и JSON требуют воспроизводимости и низкой температуры,
// а рассуждающая модель нужна только там, где важнее точность, чем скорость.
export const routes = {
  parse_request: { model: 'GigaChat/GigaChat-3-Pro', temperature: 0, maxTokens: 1500 },
  // Каркас — творческий шаг, но формулировки должны повторяться между запусками,
  // поэтому температура невысокая. Reasoning здесь не нужна: каркас по ТЗ строится за 3 минуты.
  // Вопросы должны повторяться для одного запроса: ответы хранятся под их id.
  clarify_questions: { model: 'GigaChat/GigaChat-3-Pro', temperature: 0, maxTokens: 1500 },
  draft_skeleton: { model: 'GigaChat/GigaChat-3-Pro', temperature: 0.3, maxTokens: 4096 },
} satisfies Record<string, StepRoute>;

export type StepId = keyof typeof routes;

export function callCost(model: ModelId, promptTokens: number, completionTokens: number) {
  const price = models[model];
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}
