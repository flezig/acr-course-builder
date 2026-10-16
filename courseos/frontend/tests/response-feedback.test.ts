import { afterEach, expect, it, vi } from 'vitest';
import { DemoCourseApi } from '../src/entities/course/api/demo-course-api';
import {
  summarizeAiEdits,
  summarizeFeedback,
  type AiEditOutcome,
  type FeedbackInput,
  type ResponseFeedback,
} from '../src/entities/course/model/feedback';

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

it('демо сохраняет отзывы отдельно от курсов, правит их и стирает при сбросе', async () => {
  const stored = stubStorage();
  const api = new DemoCourseApi();
  const entry = await api.recordFeedback(base);
  expect(entry).toMatchObject({ status: 'new', updated_at: null, mode: 'demo' });
  const updated = await api.updateFeedback(entry.id, { status: 'resolved', comment: 'Готово' });
  expect(updated).toMatchObject({ status: 'resolved', comment: 'Готово', rating: 'down' });
  expect(updated.updated_at).not.toBeNull();
  await api.recordAiEditOutcome({
    course_id: 'course-1',
    course_version: 2,
    course_title: 'Python для аналитиков',
    scope: 'curriculum',
    request: 'Сократи лекции',
    response_note: null,
    changes: [{ label: 'Тема 1 · содержание', decision: 'reject' }],
  });
  expect(await api.listFeedback()).toEqual([updated]);
  expect(await api.listAiEditOutcomes()).toHaveLength(1);
  expect(stored.has('courseos-demo-v1')).toBe(false);
  await api.reset();
  expect(await api.listFeedback()).toEqual([]);
  expect(await api.listAiEditOutcomes()).toEqual([]);
});

it('отзывы, сохранённые до появления разбора, читаются как новые', async () => {
  const stored = stubStorage();
  stored.set(
    'courseos-feedback-demo',
    JSON.stringify([{ ...base, id: 'old', mode: 'demo', created_at: '2026-10-16T10:00:00Z' }]),
  );
  expect(await new DemoCourseApi().listFeedback()).toMatchObject([
    { id: 'old', status: 'new', updated_at: null },
  ]);
});

it('повреждённые отзывы и правка несуществующего отзыва дают ошибку', async () => {
  const stored = stubStorage();
  await expect(new DemoCourseApi().updateFeedback('нет', { status: 'resolved' })).rejects.toThrow(
    'не найден',
  );
  stored.set('courseos-feedback-demo', '{не json');
  await expect(new DemoCourseApi().listFeedback()).rejects.toThrow('не читаются');
});

it('сводка ставит первыми разделы с жалобами и считает неразобранные', () => {
  const entry = (input: Partial<ResponseFeedback>): ResponseFeedback => ({
    ...base,
    id: crypto.randomUUID(),
    mode: 'demo',
    created_at: '2026-10-17T10:00:00.000Z',
    status: 'new',
    updated_at: null,
    ...input,
  });
  const summary = summarizeFeedback([
    entry({ section: 'map', rating: 'up', reasons: [] }),
    entry({ section: 'plan', reasons: ['structure', 'incomplete'] }),
    entry({ section: 'plan', reasons: ['structure'], status: 'resolved' }),
  ]);
  expect(summary).toMatchObject({ total: 3, liked: 1, disliked: 2, awaitingReview: 1 });
  expect(summary.bySection[0]).toEqual({ section: 'plan', liked: 0, disliked: 2 });
  expect(summary.dislikeReasons).toEqual([
    { reason: 'structure', count: 2 },
    { reason: 'incomplete', count: 1 },
  ]);
});

it('итоги правок ИИ объединяют одинаковые поля разных тем', () => {
  const outcome = (changes: AiEditOutcome['changes']): AiEditOutcome => ({
    id: crypto.randomUUID(),
    course_id: 'course-1',
    course_version: 1,
    course_title: 'Python',
    scope: 'curriculum',
    request: null,
    response_note: null,
    mode: 'demo',
    created_at: '2026-10-17T10:00:00.000Z',
    changes,
  });
  const summary = summarizeAiEdits([
    outcome([
      { label: 'Тема 1 · содержание', decision: 'reject' },
      { label: 'Тема 2 · название', decision: 'accept' },
    ]),
    outcome([{ label: 'Тема 3 · содержание', decision: 'reject' }]),
  ]);
  expect(summary).toMatchObject({ proposals: 2, accepted: 1, rejected: 2 });
  expect(summary.byScope).toEqual([{ scope: 'curriculum', accepted: 1, rejected: 2 }]);
  expect(summary.mostRejected).toEqual([{ field: 'Тема · содержание', rejected: 2, total: 2 }]);
});
