import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeSkeleton } from '../src/entities/course/model/factory';
import { DemoCourseApi } from '../src/entities/course/api/demo-course-api';
import { presets } from '../src/entities/course/model/presets';
import { demoClarifications } from '../src/entities/course/model/demo-clarifications';
import { skeletonRationaleMarkdown } from '../src/entities/course/model/rationale';
import type { Requirements } from '../src/entities/course/model/schema';

let api: DemoCourseApi;
beforeEach(() => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('navigator', {});
  api = new DemoCourseApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const requirements = (id: string): Requirements => ({
  ...structuredClone(presets.find((preset) => preset.id === id)!.requirements),
  demo_example: id as Requirements['demo_example'],
});
async function start(input: Requirements) {
  const result = await api.command({
    action: 'start',
    payload: input,
    request_id: crypto.randomUUID(),
  });
  vi.advanceTimersByTime(1000);
  return api.get(result.course_id);
}

it.each(presets.map((preset) => preset.id))(
  '%s: вопросы обязательны, ответы меняют темы и сохраняются после загрузки',
  async (id) => {
    const input = requirements(id);
    const initial = await start(input);
    expect(initial.job?.status).toBe('awaiting_clarification');
    expect(initial.snapshot).toBeNull();
    const questions = demoClarifications[id];
    expect(questions.length).toBeGreaterThanOrEqual(1);
    expect(questions.length).toBeLessThanOrEqual(2);
    for (const question of questions) {
      expect(question.options.length).toBeGreaterThanOrEqual(2);
      expect(question.options).toContain(question.recommended);
      expect(initial.questions.find((item) => item.label === question.label)?.reason).toBe(
        question.reason,
      );
    }
    await expect(
      api.command({
        action: 'clarify',
        course_id: initial.course_id,
        expected_version: 0,
        payload: { ...input, clarification_answers: { [questions[0].id]: '   ' } },
        request_id: crypto.randomUUID(),
      }),
    ).rejects.toThrow('Ответьте на все вопросы агента');
    expect((await api.get(initial.course_id)).snapshot).toBeNull();
    const answers = Object.fromEntries(
      questions.map((question) => [question.id, question.options[1]]),
    );
    await api.command({
      action: 'clarify',
      course_id: initial.course_id,
      expected_version: 0,
      request_id: crypto.randomUUID(),
      payload: {
        ...input,
        template_id: 'acr_general',
        total_hours: input.total_hours || '72',
        entry_level: 'Начальный',
        delivery: 'Очно',
        assessment: 'Защита проекта',
        clarification_answers: answers,
      },
    });
    vi.advanceTimersByTime(1000);
    const view = await new DemoCourseApi().get(initial.course_id);
    const snapshot = view.snapshot!;
    expect(snapshot).not.toBeNull();
    expect(snapshot.skeleton.requirements.clarification_answers).toEqual(answers);
    expect(snapshot.materials).toHaveLength(0);
    expect(view.questions).toHaveLength(0);
    for (const question of questions) {
      const topic = snapshot.skeleton.topics[question.topic - 1];
      expect(topic.content).toContain(answers[question.id]);
      expect(
        snapshot.skeleton.rationales?.find((rationale) => rationale.element_id === topic.id)
          ?.purpose,
      ).toContain(question.label);
      const report = skeletonRationaleMarkdown(snapshot);
      expect(report).toContain(question.label);
      expect(report).toContain(answers[question.id]);
    }
  },
);

it('собственный ответ и заполнение пропущенных полей требуются вместе', async () => {
  const input = requirements('security');
  const initial = await start(input);
  expect(initial.questions).toHaveLength(6);
  const answer = 'Поиск подозрительных писем';
  await expect(
    api.command({
      action: 'clarify',
      course_id: initial.course_id,
      expected_version: 0,
      request_id: crypto.randomUUID(),
      payload: { ...input, clarification_answers: { focus: answer } },
    }),
  ).rejects.toThrow('Ответьте на все недостающие вопросы');
  await api.command({
    action: 'clarify',
    course_id: initial.course_id,
    expected_version: 0,
    request_id: crypto.randomUUID(),
    payload: {
      ...input,
      template_id: 'acr_general',
      total_hours: '72',
      entry_level: 'Начальный',
      delivery: 'Очно',
      assessment: 'Проект',
      clarification_answers: { focus: answer },
    },
  });
  vi.advanceTimersByTime(1000);
  expect((await api.get(initial.course_id)).snapshot!.skeleton.topics[4].content).toContain(answer);
});

it('собственный запрос сохраняет прежнее поведение, даже если тема совпадает с примером', async () => {
  const input = requirements('python');
  delete input.demo_example;
  const view = await start(input);
  expect(view.snapshot).not.toBeNull();
  expect(view.questions).toHaveLength(0);
  const incomplete = await start({ ...input, entry_level: '' });
  expect(incomplete.questions).toEqual([
    { field: 'entry_level', label: 'Какой входной уровень слушателей?' },
  ]);
});

it('каждый выбор меняет содержание связанной темы, включая свой вариант', () => {
  for (const preset of presets) {
    const input = requirements(preset.id);
    if (preset.id === 'security')
      Object.assign(input, {
        template_id: 'acr_general',
        total_hours: '72',
        entry_level: 'Начальный',
        delivery: 'Очно',
        assessment: 'Проект',
      });
    for (const question of demoClarifications[preset.id]) {
      const contents = [...question.options, 'Собственный учебный сценарий'].map((answer) => {
        const skeleton = makeSkeleton({
          ...input,
          clarification_answers: { [question.id]: answer },
        });
        const topic = skeleton.topics[question.topic - 1];
        expect(topic.content).toContain(answer);
        return topic.content;
      });
      expect(new Set(contents).size).toBe(question.options.length + 1);
    }
  }
});

it('одного ответа для Python недостаточно; до всех ответов нельзя утвердить структуру', async () => {
  const input = requirements('python');
  const initial = await start(input);
  await expect(
    api.command({
      action: 'clarify',
      course_id: initial.course_id,
      expected_version: 0,
      request_id: crypto.randomUUID(),
      payload: { ...input, clarification_answers: { project: 'Чат-бот' } },
    }),
  ).rejects.toThrow('Ответьте на все вопросы агента');
  await expect(
    api.command({
      action: 'approve',
      course_id: initial.course_id,
      expected_version: 0,
      request_id: crypto.randomUUID(),
      payload: { skeleton_version: 1, skeleton_hash: 'несуществующая структура' },
    }),
  ).rejects.toThrow();
  const view = await api.get(initial.course_id);
  expect(view.snapshot).toBeNull();
  expect(view.questions).toHaveLength(2);
});

it('переименование выбранного примера сохраняет его темы для уточнений', () => {
  const input = requirements('python');
  input.title = 'Программирование для восьмого класса';
  input.clarification_answers = { project: 'Чат-бот', environment: 'В онлайн-среде' };
  const skeleton = makeSkeleton(input);
  expect(skeleton.topics[6].title).toContain('Чат-бот');
  expect(skeleton.topics[0].content).toContain('В онлайн-среде');
  expect(skeleton.requirements.title).toBe(input.title);
});
