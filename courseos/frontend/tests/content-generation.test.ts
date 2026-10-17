import { describe, expect, it } from 'vitest';
import {
  generateContent,
  repairRequest,
  type ContentSteps,
} from '../src/entities/course/model/content-generation';
import { makeMaterials, makeSkeleton } from '../src/entities/course/model/factory';
import { generationRequests } from '../src/entities/course/model/generated-materials';
import { presets } from '../src/entities/course/model/presets';
import type { ModelDesign, Requirements } from '../src/entities/course/model/schema';

const usage = {
  model: 'GigaChat/GigaChat-3-Pro',
  prompt_tokens: 1000,
  completion_tokens: 500,
  cost_rub: 0.16,
  duration_ms: 5000,
  cached: false,
};

const design: ModelDesign = {
  goal: 'Научить анализировать данные на Python',
  tasks: ['Освоить pandas'],
  module_titles: ['Основы Python', 'Анализ'],
  outcomes: [
    {
      kind: 'skill',
      title: 'Очищает данные',
      description: 'Очищает таблицы в pandas',
      criteria: ['Без ошибок'],
    },
    {
      kind: 'proficiency',
      title: 'Строит отчёт',
      description: 'Готовит отчёт',
      criteria: ['Воспроизводим'],
    },
  ],
  topics: [
    {
      module: 1,
      title: 'Синтаксис',
      content: 'Переменные',
      profile: 'intro',
      weight: 2,
      weight_reason: '',
      outcomes: [1],
      prerequisites: [],
      control: 'Опрос',
    },
    {
      module: 2,
      title: 'Pandas',
      content: 'Таблицы',
      profile: 'tool',
      weight: 4,
      weight_reason: '',
      outcomes: [1],
      prerequisites: [1],
      control: 'Практикум',
    },
    {
      module: 2,
      title: 'Отчёт',
      content: 'Графики',
      profile: 'project',
      weight: 3,
      weight_reason: '',
      outcomes: [2],
      prerequisites: [2],
      control: 'Практикум',
    },
  ],
  issues: [],
  generated_by: { ...usage },
};

const requirements = (delivery?: string): Requirements => ({
  ...structuredClone(presets.find((preset) => preset.id === 'bank')!.requirements),
  demo_example: undefined,
  total_hours: '72',
  model_design: design,
  ...(delivery ? { delivery } : {}),
});

const steps = (failTopic?: string): ContentSteps => ({
  topic: async (input) => {
    if (input.topic.number === failTopic) throw new Error('шлюз недоступен');
    return {
      topic_id: input.topic.id,
      materials: {
        lecture_points: ['Что такое DataFrame'],
        practice: { title: 'Практикум «Очистка выгрузки»', points: ['Удалить дубли'] },
        self_study_points: ['Повторить пример'],
        slides: [{ title: 'DataFrame', bullets: ['Строки и столбцы'], notes: 'Покажите пример' }],
        seminar: {
          title: 'Очистка выгрузки',
          task: 'Дана выгрузка клиентов',
          steps: ['Загрузить', 'Очистить'],
          expected: 'Ноутбук',
          criteria: ['Нет дублей'],
        },
        control_questions: ['Что такое индекс?'],
      },
      usage,
    };
  },
  test: async (input) => ({
    questions: Array.from({ length: input.question_count }, (_, i) => ({
      text: `Вопрос ${i + 1}`,
      options: ['А', 'Б', 'В', 'Г'],
      correct_index: i % 4,
      explanation: 'Потому что',
      outcome_code: input.brief.outcomes[i % 2].code,
    })),
    issues: [],
    usage,
  }),
  final: async () => ({
    final: {
      title: 'Защита аналитического отчёта',
      description: 'Слушатель готовит отчёт',
      requirements: ['Ноутбук', 'Записка'],
      example_task: 'Проанализировать отток',
      criteria: [
        { name: 'Корректность', max_points: 60, levels: 'низкий/средний/высокий' },
        { name: 'Презентация', max_points: 40, levels: 'низкий/средний/высокий' },
      ],
      pass_threshold: 70,
      procedure: ['Доклад 5 минут'],
      interview_questions: [
        { module: 1, questions: ['Что такое переменная?'] },
        { module: 2, questions: ['Как удалить дубли?'] },
      ],
    },
    issues: [],
    usage,
  }),
  sections: async () => ({
    sections: {
      relevance: 'Банкам нужны аналитики',
      methodical: 'Сначала пример, затем практика',
      organization: 'Очно-заочно',
      environment: ['Python 3.12', 'pandas 2.2'],
      literature: [
        { group: 'main', citation: 'Маккинни У. Python и анализ данных' },
        {
          group: 'internet',
          citation: 'Документация pandas. — URL: https://pandas.pydata.org/docs/',
        },
      ],
    },
    usage,
  }),
  repairTest: async (input) => ({
    questions: [
      ...input.replace.map((q) => ({
        text: `Исправленный ${q.number}`,
        options: ['А', 'Б', 'В', 'Г'],
        correct_index: 0,
        explanation: 'Исправлено',
        outcome_code: q.outcome,
      })),
    ],
    usage,
  }),
  review: async () => ({
    issues: [
      { severity: 'error', element: 'Вопрос 3', message: 'Два верных ответа', fix: 'Уточнить' },
    ],
    summary: 'В целом согласовано',
    usage: { ...usage, model: 'ai-sage/GigaChat3.5-432B-A28B-Reasoning' },
  }),
});

describe('генерация материалов по каркасу от модели', () => {
  it('нумерует темы по модулям и требует не меньше 10 вопросов', () => {
    const requests = generationRequests(makeSkeleton(requirements()));
    expect(requests.topics.map((t) => t.topic.number)).toEqual(['1.1', '2.1', '2.2']);
    expect(requests.topics[1].previous_topics).toEqual(['1.1. Синтаксис']);
    expect(requests.test.question_count).toBe(10);
    expect(requests.test.brief.outcomes.map((o) => o.code)).toEqual(['РО 1', 'РО 2']);
  });

  it('раскладывает тексты по материалам, не меняя связей и часов', async () => {
    const skeleton = makeSkeleton(requirements());
    const base = await makeMaterials(skeleton);
    const { materials, generation } = await generateContent(skeleton, base, steps());
    const program = materials.find((m) => m.id === 'working_program-topic-2')!;
    expect(program.content).toMatch(/^ЛК \(\d+ ч\):\n- Что такое DataFrame/);
    expect(program.content).toContain('Практикум «Очистка выгрузки»');
    const test = materials.find((m) => m.type === 'test')!;
    expect(test.questions).toHaveLength(10);
    expect(test.questions.every((q) => q.outcome_ids.length === 1)).toBe(true);
    expect(test.test_policy).toEqual({ pass_count: 7 });
    const final = materials.find((m) => m.topic_id === 'topic-final')!;
    expect(final.title).toBe('Защита аналитического отчёта');
    expect(final.criteria[0]).toMatch(/до 60 баллов/);
    expect(materials.map((m) => m.id)).toEqual(expect.arrayContaining(base.map((m) => m.id)));
    expect(generation.calls.map((c) => c.step)).toEqual([
      'course_test',
      'final_assessment',
      'program_sections',
      'topic_materials',
      'topic_materials',
      'topic_materials',
      'review_course',
      'test_repair',
    ]);
    // Замечание самопроверки к вопросу 3 исправлено отдельным шагом.
    expect(test.questions[2].text).toBe('Исправленный 3');
    expect(test.questions[3].text).toBe('Вопрос 4');
    expect(generation.review?.issues[0].resolved).toBe(true);
    expect(materials.some((m) => m.type === 'mentor_interview')).toBe(false);
    expect(generation.program_sections?.environment).toEqual(['Python 3.12', 'pandas 2.2']);
    expect(generation.failed).toEqual([]);
  });

  it('при сбое темы оставляет её заготовкой и сообщает причину', async () => {
    const skeleton = makeSkeleton(requirements());
    const base = await makeMaterials(skeleton);
    const { materials, generation } = await generateContent(skeleton, base, steps('2.1'));
    expect(materials.find((m) => m.id === 'working_program-topic-2')!.content).toBe(
      base.find((m) => m.id === 'working_program-topic-2')!.content,
    );
    expect(generation.failed).toEqual(['Тема 2.1: шлюз недоступен']);
  });

  it('на стажировке добавляет собеседования с руководителем по модулям', async () => {
    const skeleton = makeSkeleton(requirements('Стажировка с применением ДОТ'));
    const { materials } = await generateContent(skeleton, await makeMaterials(skeleton), steps());
    expect(materials.filter((m) => m.type === 'mentor_interview').map((m) => m.module_id)).toEqual([
      'module-1',
      'module-2',
    ]);
  });

  it('доработка добирает вопросы до нужного числа и покрывает все результаты', () => {
    const brief = generationRequests(makeSkeleton(requirements())).test.brief;
    const question = (code: string) => ({
      text: 'В',
      options: ['а', 'б'],
      correct_index: 0,
      explanation: '',
      outcome_code: code,
    });
    const repair = repairRequest(
      brief,
      { questions: Array.from({ length: 8 }, () => question('РО 1')), issues: [], usage },
      { issues: [], summary: '', usage },
      10,
    );
    expect(repair.add).toEqual(['РО 2', 'РО 2']);
  });
});
