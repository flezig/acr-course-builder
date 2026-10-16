import { z } from 'zod';

export const feedbackSubjectTitles = {
  generation: 'Сгенерированный раздел',
  ai_edit: 'Правка с ИИ',
} as const;

// Страницы программы и области правки с ИИ. «materials» общий для обоих:
// и страница, и область правки называются одинаково.
export const feedbackSectionTitles = {
  plan: 'Программа и учебный план',
  map: 'Карта результатов',
  audit: 'Проверка программы',
  materials: 'Материалы и выгрузки',
  intent: 'О программе',
  curriculum: 'Учебный план',
  calendar: 'Календарь',
  outcomes: 'Карта результатов',
} as const;

// Короткий список причин, чтобы отзывы можно было сгруппировать и посчитать.
// Подробности методист пишет в комментарии.
export const feedbackReasons = {
  precise: { rating: 'up', title: 'Точно по запросу' },
  saves_time: { rating: 'up', title: 'Экономит время' },
  good_wording: { rating: 'up', title: 'Хорошие формулировки' },
  factual_error: { rating: 'down', title: 'Фактическая ошибка' },
  off_request: { rating: 'down', title: 'Не то, что просили' },
  incomplete: { rating: 'down', title: 'Неполно' },
  structure: { rating: 'down', title: 'Ошибка в часах или структуре' },
  poor_wording: { rating: 'down', title: 'Неудачные формулировки' },
} as const satisfies Record<string, { rating: 'up' | 'down'; title: string }>;

// Разбор нужен только жалобам: положительные отзывы остаются «новыми».
export const feedbackStatusTitles = {
  new: 'Новый',
  in_progress: 'В работе',
  resolved: 'Исправлено',
} as const;

export type FeedbackSection = keyof typeof feedbackSectionTitles;
export type FeedbackStatus = keyof typeof feedbackStatusTitles;
export type FeedbackReason = keyof typeof feedbackReasons;
export type FeedbackRating = 'up' | 'down';

export const feedbackInputSchema = z.object({
  course_id: z.string(),
  course_version: z.number().int().positive(),
  course_title: z.string(),
  subject: z.enum(['generation', 'ai_edit']),
  section: z.enum(Object.keys(feedbackSectionTitles) as [FeedbackSection, ...FeedbackSection[]]),
  rating: z.enum(['up', 'down']),
  reasons: z.array(z.enum(Object.keys(feedbackReasons) as [FeedbackReason, ...FeedbackReason[]])),
  comment: z.string().max(2000),
  // Запрос методиста к ИИ и пояснение ответа: без них отзыв о правке не воспроизвести.
  request: z.string().nullable(),
  response_note: z.string().nullable(),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export const feedbackSchema = feedbackInputSchema.extend({
  id: z.string(),
  mode: z.enum(['demo', 'live']),
  created_at: z.string(),
  // Значения по умолчанию читают отзывы, сохранённые до появления разбора.
  status: z
    .enum(Object.keys(feedbackStatusTitles) as [FeedbackStatus, ...FeedbackStatus[]])
    .default('new'),
  updated_at: z.string().nullable().default(null),
});
export type ResponseFeedback = z.infer<typeof feedbackSchema>;
export type FeedbackPatch = Partial<
  Pick<ResponseFeedback, 'rating' | 'reasons' | 'comment' | 'status'>
>;

// Итог правки с ИИ: какие поля методист утвердил, а какие оставил как было.
// Записывается сам, без отдельной оценки, поэтому это самый полный сигнал о правках.
export const aiEditOutcomeInputSchema = z.object({
  course_id: z.string(),
  course_version: z.number().int().positive(),
  course_title: z.string(),
  scope: z.enum(['intent', 'curriculum', 'calendar', 'outcomes', 'materials']),
  request: z.string().nullable(),
  response_note: z.string().nullable(),
  changes: z.array(z.object({ label: z.string(), decision: z.enum(['accept', 'reject']) })).min(1),
});
export type AiEditOutcomeInput = z.infer<typeof aiEditOutcomeInputSchema>;
export const aiEditOutcomeSchema = aiEditOutcomeInputSchema.extend({
  id: z.string(),
  mode: z.enum(['demo', 'live']),
  created_at: z.string(),
});
export type AiEditOutcome = z.infer<typeof aiEditOutcomeSchema>;

export interface FeedbackSummary {
  total: number;
  liked: number;
  disliked: number;
  awaitingReview: number;
  bySection: { section: FeedbackSection; liked: number; disliked: number }[];
  dislikeReasons: { reason: FeedbackReason; count: number }[];
}

export function summarizeFeedback(entries: ResponseFeedback[]): FeedbackSummary {
  const sections = new Map<FeedbackSection, { liked: number; disliked: number }>();
  const reasons = new Map<FeedbackReason, number>();
  for (const entry of entries) {
    const counts = sections.get(entry.section) ?? { liked: 0, disliked: 0 };
    if (entry.rating === 'up') counts.liked++;
    else counts.disliked++;
    sections.set(entry.section, counts);
    if (entry.rating === 'down')
      for (const reason of entry.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const liked = entries.filter((entry) => entry.rating === 'up').length;
  return {
    total: entries.length,
    liked,
    disliked: entries.length - liked,
    awaitingReview: entries.filter((entry) => entry.rating === 'down' && entry.status === 'new')
      .length,
    // Сначала разделы, где больше всего недовольных: их и нужно разбирать в первую очередь.
    bySection: [...sections]
      .map(([section, counts]) => ({ section, ...counts }))
      .sort((a, b) => b.disliked - a.disliked || b.liked - a.liked),
    dislikeReasons: [...reasons]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export interface AiEditSummary {
  proposals: number;
  accepted: number;
  rejected: number;
  byScope: { scope: AiEditOutcome['scope']; accepted: number; rejected: number }[];
  mostRejected: { field: string; rejected: number; total: number }[];
}

export function summarizeAiEdits(outcomes: AiEditOutcome[]): AiEditSummary {
  const scopes = new Map<AiEditOutcome['scope'], { accepted: number; rejected: number }>();
  const fields = new Map<string, { rejected: number; total: number }>();
  let accepted = 0;
  for (const outcome of outcomes)
    for (const change of outcome.changes) {
      const counts = scopes.get(outcome.scope) ?? { accepted: 0, rejected: 0 };
      // «Тема 3 · содержание» и «Тема 5 · содержание» — один вид поля:
      // номера убираем, чтобы видеть, какие тексты ИИ пишет хуже.
      const field = change.label.replace(/\s\d+/g, '');
      const fieldCounts = fields.get(field) ?? { rejected: 0, total: 0 };
      fieldCounts.total++;
      if (change.decision === 'accept') {
        accepted++;
        counts.accepted++;
      } else {
        counts.rejected++;
        fieldCounts.rejected++;
      }
      scopes.set(outcome.scope, counts);
      fields.set(field, fieldCounts);
    }
  const total = outcomes.reduce((sum, outcome) => sum + outcome.changes.length, 0);
  return {
    proposals: outcomes.length,
    accepted,
    rejected: total - accepted,
    byScope: [...scopes]
      .map(([scope, counts]) => ({ scope, ...counts }))
      .sort((a, b) => b.rejected - a.rejected),
    mostRejected: [...fields]
      .filter(([, counts]) => counts.rejected > 0)
      .map(([field, counts]) => ({ field, ...counts }))
      .sort((a, b) => b.rejected - a.rejected || b.total - a.total)
      .slice(0, 8),
  };
}
