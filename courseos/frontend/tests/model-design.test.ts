import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoCourseApi } from '../src/entities/course/api/demo-course-api';
import { makeSkeleton } from '../src/entities/course/model/factory';
import { presets } from '../src/entities/course/model/presets';
import { hourTotals } from '../src/entities/course/model/rules';
import type { ModelDesign, Requirements } from '../src/entities/course/model/schema';
import { sumHours } from '../src/shared/lib/decimal';

const topic = (module: number, title: string, weight: number, outcomes: number[]) => ({
  module,
  title,
  content: `Разбор и практика: ${title}`,
  profile: 'tool' as const,
  weight,
  weight_reason: 'оценка трудоёмкости',
  outcomes,
  prerequisites: [],
  control: 'Практическое задание',
});

const design: ModelDesign = {
  goal: 'Научить сотрудников банков анализировать данные на Python',
  tasks: ['Освоить pandas', 'Научиться строить отчёты'],
  module_titles: ['Основы', 'Отчёты'],
  outcomes: [
    {
      kind: 'skill',
      title: 'Обрабатывает данные',
      description: 'Загружает и очищает таблицы в pandas',
      criteria: ['Очищает выгрузку без ошибок'],
    },
    {
      kind: 'proficiency',
      title: 'Строит отчёт',
      description: 'Готовит отчёт с графиками для руководителя',
      criteria: ['Отчёт воспроизводится скриптом', 'Выводы обоснованы'],
    },
  ],
  topics: [
    topic(1, 'Синтаксис Python', 2, [1]),
    topic(1, 'Pandas', 4, [1]),
    topic(2, 'Графики и отчёт', 3, [2]),
  ],
  issues: [],
  generated_by: {
    model: 'GigaChat/GigaChat-3-Pro',
    prompt_tokens: 1700,
    completion_tokens: 1600,
    cost_rub: 0.41,
    duration_ms: 12000,
    cached: false,
  },
};

const requirements = (total: string): Requirements => ({
  ...structuredClone(presets.find((preset) => preset.id === 'bank')!.requirements),
  demo_example: undefined,
  total_hours: total,
  model_design: design,
});

describe('каркас по структуре модели', () => {
  it('берёт смысл у модели, а часы считает кодом без расхождений', () => {
    const skeleton = makeSkeleton(requirements('72'));
    // Аудитория «сотрудники банков» не включает заготовку банковского сценария.
    expect(skeleton.topics.map((t) => t.title)).toEqual([
      'Синтаксис Python',
      'Pandas',
      'Графики и отчёт',
      'Итоговая аттестация',
    ]);
    expect(skeleton.tasks).toEqual(design.tasks);
    expect(skeleton.outcomes.map((o) => o.description)).toEqual(
      design.outcomes.map((o) => o.description),
    );
    expect(sumHours(skeleton.topics.map((t) => t.planned_total))).toBe('72');
    expect(sumHours(Object.values(hourTotals(skeleton)))).toBe('72');
    for (const t of skeleton.topics)
      expect(sumHours(Object.values(t.hours))).toBe(sumHours([t.planned_total]));
    // Более трудоёмкая тема получает больше часов.
    expect(Number(skeleton.topics[1].planned_total)).toBeGreaterThan(
      Number(skeleton.topics[0].planned_total),
    );
  });

  it('текущий контроль результата стоит в первой теме, которая его формирует', () => {
    const skeleton = makeSkeleton(requirements('72'));
    const current = skeleton.assessments.filter((a) => a.topic_id !== 'topic-final');
    expect(current.map((a) => [a.outcome_ids[0], a.topic_id])).toEqual([
      ['outcome-1', 'topic-1'],
      ['outcome-2', 'topic-3'],
    ]);
    expect(current[1].criterion).toBe('Отчёт воспроизводится скриптом; Выводы обоснованы');
  });

  it('при смене объёма часы пересчитываются по той же структуре', () => {
    const skeleton = makeSkeleton(requirements('36'));
    expect(skeleton.topics).toHaveLength(4);
    expect(sumHours(skeleton.topics.map((t) => t.planned_total))).toBe('36');
  });
});

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('уточняющие вопросы модели', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('navigator', {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ждут ответа, а каркас строится из структуры, спроектированной с ответами', async () => {
    const api = new DemoCourseApi();
    const question = {
      id: 'model-1',
      label: 'Какой итоговый проект?',
      reason: 'От ответа зависят темы второй половины курса.',
      options: ['Скоринг', 'Отток клиентов'],
      recommended: 'Скоринг',
    };
    const { model_design: _, ...withoutDesign } = requirements('72');
    const started = await api.command({
      action: 'start',
      request_id: crypto.randomUUID(),
      payload: { ...withoutDesign, model_questions: [question] },
    });
    vi.advanceTimersByTime(500);
    const waiting = await api.get(started.course_id);
    expect(waiting.job.status).toBe('awaiting_clarification');
    expect(waiting.questions).toEqual([
      expect.objectContaining({
        field: 'clarification_answers.model-1',
        label: question.label,
        options: question.options,
        recommended: 'Скоринг',
      }),
    ]);

    await api.command({
      action: 'clarify',
      course_id: started.course_id,
      expected_version: 0,
      request_id: crypto.randomUUID(),
      payload: {
        ...waiting.requirements,
        clarification_answers: { 'model-1': 'Отток клиентов' },
        model_design: design,
      },
    });
    vi.advanceTimersByTime(500);
    const built = await api.get(started.course_id);
    expect(built.questions).toEqual([]);
    expect(built.snapshot!.skeleton.requirements.clarification_answers).toEqual({
      'model-1': 'Отток клиентов',
    });
    expect(built.snapshot!.skeleton.topics.map((t) => t.title)).toContain('Pandas');
  });
});
