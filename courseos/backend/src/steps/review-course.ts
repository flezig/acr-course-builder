import { z } from 'zod';
import type { LlmGateway } from '../llm/gateway.ts';
import { chatStructured } from './structured.ts';

// Самопроверка — последний шаг агента. Арифметику часов, покрытие результатов и пустые поля
// проверяет код правилами; модель ищет только смысловые проблемы, которые правилом
// не поймать: неверные ключи тестов, темы не по уровню слушателей, обещания сверх объёма.
export const reviewInputSchema = z.object({
  title: z.string().min(1),
  goal: z.string().default(''),
  template: z.string(),
  audience: z.string(),
  entry_level: z.string(),
  total_hours: z.coerce.number(),
  constraints: z.string().default(''),
  materials: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        title: z.string(),
        topic_id: z.string(),
        content: z.string(),
        expected: z.string(),
        criteria: z.array(z.string()),
        slides: z.array(
          z.object({ title: z.string(), bullets: z.array(z.string()), notes: z.string() }),
        ),
      }),
    )
    .default([]),
  program_sections: z.unknown().optional(),
  outcomes: z
    .array(
      z.object({
        code: z.string(),
        description: z.string(),
        criteria: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  topics: z
    .array(
      z.object({
        number: z.string(),
        title: z.string(),
        hours: z.string(),
        outcomes: z.array(z.string()),
        summary: z.string().max(12000),
      }),
    )
    .min(1)
    .max(40),
  questions: z
    .array(
      z.object({
        number: z.number(),
        text: z.string(),
        options: z.array(z.string()),
        correct: z.string(),
        explanation: z.string().default(''),
        outcome: z.string(),
      }),
    )
    .max(30),
  final: z.string().max(3000),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;

const reviewAnswerSchema = z.object({
  issues: z
    .array(
      z.object({
        severity: z.enum(['error', 'warning']).catch('warning'),
        element: z.string().min(1),
        message: z.string().min(1),
        fix: z.string().trim().min(1),
      }),
    )
    .max(20),
  summary: z.string().default(''),
});

export type ReviewIssue = z.infer<typeof reviewAnswerSchema>['issues'][number];

const instructions = `Ты эксперт-методист, который проверяет черновик образовательной программы перед передачей методисту. Найди смысловые ошибки.

Проверь:
1. Ключи теста: верный ли ответ отмечен, нет ли второго верного варианта, понятна ли формулировка.
2. Соответствие уровню: нет ли тем, требующих знаний, которые слушатели ещё не получили; подходит ли язык аудитории.
3. Реалистичность: не обещают ли результаты больше, чем можно освоить за объём программы.
4. Связь: проверяет ли итоговая аттестация результаты обучения; нет ли тем, не связанных с целью.
5. Фактические ошибки и устаревшие или недоступные в России инструменты.
6. Объяснения ответов: соответствуют ли ключу, нет ли противоречий или неоднозначности.
7. Практика: есть ли конкретные исходные данные, сдаваемый результат, измеримые критерии и достаточно ли выделенного времени.
8. Согласованность каркаса, текстов программы DOCX, слайдов PPTX и теста: одни темы, термины, часы и проверяемые результаты. Проверяй весь переданный комплект.

Не проверяй арифметику часов и оформление — это делает код. Не придумывай проблем: если всё в порядке, верни пустой список.
severity: error — ошибка, которую нужно исправить до выдачи слушателям (неверный ключ, фактическая ошибка); warning — стоит проверить.
element — где проблема: «Вопрос 3», «Тема 1.2», «Результат РО-2», «Итоговая аттестация».

Верни только JSON без пояснений и Markdown:
{"issues": [{"severity": "error", "element": "Вопрос 3", "message": "...", "fix": "..."}], "summary": "одно предложение об общем качестве"}`;

function brief(input: ReviewInput) {
  return [
    `Программа «${input.title}» (${input.template}), ${input.total_hours} ч.`,
    `Цель: ${input.goal}`,
    `Слушатели: ${input.audience}; входной уровень: ${input.entry_level}.`,
    'Результаты обучения:',
    ...input.outcomes.map(
      (o) => `${o.code} — ${o.description}. Критерии: ${(o.criteria ?? []).join('; ')}`,
    ),
    `Ограничения: ${input.constraints}`,
    `Материалы для DOCX и PPTX, практические задания и критерии: ${JSON.stringify(input.materials)}`,
    `Разделы программы: ${JSON.stringify(input.program_sections)}`,
    'Темы:',
    ...input.topics.map(
      (t) => `${t.number}. ${t.title} (${t.hours} ч; ${t.outcomes.join(', ')}): ${t.summary}`,
    ),
    'Тест (верный ответ указан после «Ключ»):',
    ...input.questions.map(
      (q) =>
        `${q.number}. ${q.text} Варианты: ${q.options.map((o, i) => `${i + 1}) ${o}`).join('; ')}. Ключ: ${q.correct}. Объяснение: ${q.explanation}. Проверяет ${q.outcome}.`,
    ),
    `Итоговая аттестация: ${input.final}`,
  ].join('\n');
}

const reviewJsonSchema = {
  name: 'review_course',
  schema: {
    type: 'object',
    properties: {
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['error', 'warning'] },
            element: { type: 'string' },
            message: { type: 'string' },
            fix: { type: 'string' },
          },
          required: ['severity', 'element', 'message', 'fix'],
          additionalProperties: false,
        },
      },
      summary: { type: 'string' },
    },
    required: ['issues', 'summary'],
    additionalProperties: false,
  },
};

export async function reviewCourse(gateway: LlmGateway, input: ReviewInput) {
  const messages = [
    { role: 'system' as const, content: instructions },
    { role: 'user' as const, content: brief(input) },
  ];
  const { data, usage } = await chatStructured(
    gateway,
    'review_course',
    messages,
    reviewJsonSchema,
    reviewAnswerSchema,
    'Модель вернула самопроверку не по схеме. Повторите проверку.',
  );
  return { ...data, usage };
}
