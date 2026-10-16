import { z } from 'zod';

export const feedbackSubjectTitles = {
  generation: 'Сгенерированная страница',
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

export type FeedbackSection = keyof typeof feedbackSectionTitles;
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
});
export type ResponseFeedback = z.infer<typeof feedbackSchema>;

export interface FeedbackSummary {
  total: number;
  liked: number;
  disliked: number;
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
    // Сначала разделы, где больше всего недовольных: их и нужно разбирать в первую очередь.
    bySection: [...sections]
      .map(([section, counts]) => ({ section, ...counts }))
      .sort((a, b) => b.disliked - a.disliked || b.liked - a.liked),
    dislikeReasons: [...reasons]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}
