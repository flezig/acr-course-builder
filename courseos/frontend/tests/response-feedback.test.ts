import { afterEach, expect, it, vi } from 'vitest';
import { DemoCourseApi } from '../src/entities/course/api/demo-course-api';
import { summarizeFeedback, type FeedbackInput } from '../src/entities/course/model/feedback';

afterEach(() => vi.unstubAllGlobals());

function stubStorage() {
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    key: (index: number) => [...stored.keys()][index] ?? null,
    get length() {
      return stored.size;
    },
  });
  vi.stubGlobal('navigator', {});
  return stored;
}

const base: FeedbackInput = {
  course_id: 'course-1',
  course_version: 2,
  course_title: 'Python для аналитиков',
  subject: 'generation',
  section: 'plan',
  rating: 'down',
  reasons: ['structure'],
  comment: 'Часы практики не сходятся',
  request: null,
  response_note: null,
};

it('демо сохраняет отзывы отдельно от курсов и стирает их при сбросе', async () => {
  const stored = stubStorage();
  const api = new DemoCourseApi();
  await api.recordFeedback(base);
  await api.recordFeedback({
    ...base,
    subject: 'ai_edit',
    section: 'curriculum',
    rating: 'up',
    reasons: ['precise'],
    request: 'Сократи лекции',
  });
  const entries = await api.listFeedback();
  expect(entries).toHaveLength(2);
  expect(entries[1]).toMatchObject({ mode: 'demo', request: 'Сократи лекции' });
  expect(stored.has('courseos-demo-v1')).toBe(false);
  await api.reset();
  expect(await api.listFeedback()).toEqual([]);
});

it('повреждённые отзывы дают ошибку, а не пустой список', async () => {
  const stored = stubStorage();
  stored.set('courseos-feedback-demo', '{не json');
  await expect(new DemoCourseApi().listFeedback()).rejects.toThrow('не читаются');
});

it('сводка ставит первыми разделы с жалобами и считает причины', () => {
  const entry = (input: Partial<FeedbackInput>) => ({
    ...base,
    ...input,
    id: crypto.randomUUID(),
    mode: 'demo' as const,
    created_at: '2026-10-17T10:00:00.000Z',
  });
  const summary = summarizeFeedback([
    entry({ section: 'map', rating: 'up', reasons: [] }),
    entry({ section: 'plan', reasons: ['structure', 'incomplete'] }),
    entry({ section: 'plan', reasons: ['structure'] }),
  ]);
  expect(summary).toMatchObject({ total: 3, liked: 1, disliked: 2 });
  expect(summary.bySection[0]).toEqual({ section: 'plan', liked: 0, disliked: 2 });
  expect(summary.dislikeReasons).toEqual([
    { reason: 'structure', count: 2 },
    { reason: 'incomplete', count: 1 },
  ]);
});
