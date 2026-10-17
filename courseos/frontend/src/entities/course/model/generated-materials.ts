import { z } from 'zod';
import { sourceEvidenceSchema, generationSchema, type Material, type Skeleton } from './schema';
import { isInternship } from './hours-plan';
import { outcomeCodes } from '../export/outcome-codes';
import { formatHours, sumHours } from '../../../shared/lib/decimal';

// Для курса с каркасом от модели makeMaterials создаёт только заготовки. Здесь собираются
// входы для шагов генерации на сервере и их ответы раскладываются по тем же материалам:
// id, связи с темами и результатами и часы остаются из утверждённого каркаса.

const usageSchema = z.object({
  model: z.string(),
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  cost_rub: z.number(),
  duration_ms: z.number(),
  cached: z.boolean(),
});

export const topicMaterialsResultSchema = z.object({
  source_checks: z.array(sourceEvidenceSchema).optional(),
  topic_id: z.string(),
  materials: z.object({
    lecture_points: z.array(z.string()),
    practice: z.object({ title: z.string(), points: z.array(z.string()) }).nullable(),
    self_study_points: z.array(z.string()),
    slides: z.array(
      z.object({ title: z.string(), bullets: z.array(z.string()), notes: z.string() }),
    ),
    seminar: z.object({
      title: z.string(),
      task: z.string(),
      steps: z.array(z.string()),
      expected: z.string(),
      criteria: z.array(z.string()),
    }),
    control_questions: z.array(z.string()),
  }),
  usage: usageSchema,
});

export const courseTestResultSchema = z.object({
  source_checks: z.array(sourceEvidenceSchema).optional(),
  questions: z.array(
    z.object({
      text: z.string(),
      options: z.array(z.string()),
      correct_index: z.number().int(),
      explanation: z.string(),
      outcome_code: z.string(),
    }),
  ),
  issues: z.array(z.string()),
  usage: usageSchema,
});

export const finalAssessmentResultSchema = z.object({
  source_checks: z.array(sourceEvidenceSchema).optional(),
  final: z.object({
    title: z.string(),
    description: z.string(),
    requirements: z.array(z.string()),
    example_task: z.string(),
    criteria: z.array(z.object({ name: z.string(), max_points: z.number(), levels: z.string() })),
    pass_threshold: z.number(),
    procedure: z.array(z.string()),
    interview_questions: z.array(z.object({ module: z.number(), questions: z.array(z.string()) })),
  }),
  issues: z.array(z.string()),
  usage: usageSchema,
});

export const reviewResultSchema = z.object({
  issues: z.array(
    z.object({
      severity: z.enum(['error', 'warning']),
      element: z.string(),
      message: z.string(),
      fix: z.string(),
    }),
  ),
  summary: z.string(),
  usage: usageSchema,
});

export const repairTestResultSchema = z.object({
  questions: courseTestResultSchema.shape.questions,
  usage: usageSchema,
});

export const programSectionsResultSchema = z.object({
  source_checks: z.array(sourceEvidenceSchema).optional(),
  sections: generationSchema.shape.program_sections.unwrap(),
  usage: usageSchema,
});

export type ProgramSectionsResult = z.infer<typeof programSectionsResultSchema>;
export type RepairTestResult = z.infer<typeof repairTestResultSchema>;
export type TopicMaterialsResult = z.infer<typeof topicMaterialsResultSchema>;
export type CourseTestResult = z.infer<typeof courseTestResultSchema>;
export type FinalAssessmentResult = z.infer<typeof finalAssessmentResultSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type GenerationUsage = z.infer<typeof usageSchema>;

export interface GeneratedContent {
  topics: TopicMaterialsResult[];
  test: CourseTestResult | null;
  final: FinalAssessmentResult | null;
}

const studyTopics = (skeleton: Skeleton) => skeleton.topics.filter((t) => t.id !== 'topic-final');

// Номер темы как в учебно-тематическом плане образцов: модуль.тема.
export function topicNumbers(skeleton: Skeleton) {
  const modules = [...new Set(studyTopics(skeleton).map((t) => t.module_id))];
  const numbers = new Map<string, string>();
  for (const [moduleIndex, moduleId] of modules.entries())
    studyTopics(skeleton)
      .filter((t) => t.module_id === moduleId)
      .forEach((t, index) => numbers.set(t.id, `${moduleIndex + 1}.${index + 1}`));
  return { modules, numbers };
}

function moduleTitle(skeleton: Skeleton, moduleIndex: number) {
  return (
    skeleton.requirements.model_design?.module_titles[moduleIndex] ?? `Модуль ${moduleIndex + 1}`
  );
}

export function courseBrief(skeleton: Skeleton) {
  const r = skeleton.requirements;
  const codes = outcomeCodes(skeleton);
  return {
    title: r.title,
    template_id: r.template_id,
    audience: r.audience,
    entry_level: r.entry_level,
    goal: skeleton.goal,
    delivery: r.delivery,
    assessment: r.assessment,
    internship: isInternship(r),
    outcomes: skeleton.outcomes.map((o) => ({
      code: codes[o.id],
      kind: o.kind,
      criteria: o.criteria ?? [],
      description: o.title ? `${o.title}: ${o.description}` : o.description,
    })),
    constraints: r.constraints,
    references: r.references.map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      text: source.text.slice(0, 12000),
      scope: source.scope,
      coordinate: source.coordinate,
    })),
    answers: (r.model_questions ?? []).flatMap((question) => {
      const answer = r.clarification_answers?.[question.id]?.trim();
      return answer ? [`${question.label} — ${answer}`] : [];
    }),
  };
}

// По чек-листам кейса в тесте не меньше 10 вопросов и каждый результат проверяется дважды.
export function testQuestionCount(skeleton: Skeleton) {
  return Math.min(20, Math.max(10, skeleton.outcomes.length * 2));
}

export function generationRequests(skeleton: Skeleton) {
  const brief = courseBrief(skeleton);
  const codes = outcomeCodes(skeleton);
  const { modules, numbers } = topicNumbers(skeleton);
  const topics = studyTopics(skeleton);
  return {
    topics: topics.map((topic, index) => ({
      brief,
      module_title: moduleTitle(skeleton, modules.indexOf(topic.module_id)),
      topic: {
        id: topic.id,
        number: numbers.get(topic.id)!,
        title: topic.title,
        content: topic.content,
        hours: {
          lecture: topic.hours.lecture,
          practice: topic.hours.practice,
          lab: topic.hours.lab,
          self_study: topic.hours.self_study,
        },
        outcome_codes: topic.outcome_ids.map((id) => codes[id]).filter(Boolean),
        control: topic.control,
      },
      previous_topics: topics.slice(0, index).map((t) => `${numbers.get(t.id)}. ${t.title}`),
    })),
    test: {
      brief,
      topics: topics.map((t) => ({ number: numbers.get(t.id)!, title: t.title })),
      question_count: testQuestionCount(skeleton),
    },
    sections: { brief, topics: topics.map((t) => t.title) },
    final: {
      brief,
      modules: modules.map((moduleId, index) => ({
        title: moduleTitle(skeleton, index),
        topics: topics.filter((t) => t.module_id === moduleId).map((t) => t.title),
      })),
    },
  };
}

const bulletList = (items: string[]) => items.map((item) => `- ${item}`);

function workingProgramText(
  topic: Skeleton['topics'][number],
  generated: TopicMaterialsResult['materials'],
) {
  const h = topic.hours;
  const practiceHours = sumHours([h.practice, h.lab]);
  return [
    ...(generated.lecture_points.length
      ? [`ЛК (${formatHours(h.lecture)} ч):`, ...bulletList(generated.lecture_points)]
      : []),
    ...(generated.practice
      ? [
          `ПР (${formatHours(practiceHours)} ч): ${generated.practice.title}:`,
          ...bulletList(generated.practice.points),
        ]
      : []),
    ...(generated.self_study_points.length
      ? [`СРС (${formatHours(h.self_study)} ч):`, ...bulletList(generated.self_study_points)]
      : []),
    `Текущий контроль: ${topic.control}.`,
  ].join('\n');
}

// Возвращает новые материалы; заготовки без ответа модели остаются как были,
// чтобы методист видел, какая часть не сгенерирована.
export function applyGeneratedContent(
  skeleton: Skeleton,
  materials: Material[],
  content: GeneratedContent,
): Material[] {
  const codeToId = Object.fromEntries(
    Object.entries(outcomeCodes(skeleton)).map(([id, code]) => [code, id]),
  );
  const result = structuredClone(materials);
  const { modules } = topicNumbers(skeleton);
  for (const { topic_id, materials: generated } of content.topics) {
    const topic = skeleton.topics.find((t) => t.id === topic_id);
    if (!topic) continue;
    for (const material of result.filter((m) => m.topic_id === topic_id)) {
      if (material.type === 'working_program')
        material.content = workingProgramText(topic, generated);
      if (material.type === 'seminar') {
        material.title = `Практикум: ${generated.seminar.title}`;
        material.content = [
          generated.seminar.task,
          'Порядок выполнения:',
          ...generated.seminar.steps.map((step, i) => `${i + 1}. ${step}`),
        ].join('\n');
        material.expected = generated.seminar.expected;
        material.criteria = generated.seminar.criteria;
      }
      if (material.type === 'lecture' && generated.slides.length) {
        material.content = generated.lecture_points.length
          ? `План лекции:\n${bulletList(generated.lecture_points).join('\n')}`
          : material.content;
        material.slides = generated.slides.map((slide, i) => ({
          id: `slide-${topic.id}-${i + 1}`,
          ...slide,
        }));
      }
    }
    // На стажировке лекций нет: слайды нужны наставнику для установочной встречи по теме.
    if (
      generated.slides.length &&
      !result.some((m) => m.topic_id === topic_id && m.type === 'lecture') &&
      isInternship(skeleton.requirements)
    )
      result.push({
        ...result.find((m) => m.topic_id === topic_id && m.type === 'working_program')!,
        id: `lecture-${topic.id}`,
        type: 'lecture',
        title: `Установочная встреча: ${topic.title}`,
        content: 'Слайды для наставника; часы входят в самостоятельную работу темы.',
        slides: generated.slides.map((slide, i) => ({
          id: `slide-${topic.id}-${i + 1}`,
          ...slide,
        })),
        criteria: [],
        hash: '',
      });
  }
  if (content.test?.questions.length) {
    const test = result.find((m) => m.type === 'test');
    if (test) {
      test.questions = content.test.questions.map((q, i) => ({
        id: `question-${i + 1}`,
        text: q.text,
        options: q.options,
        correct_index: q.correct_index,
        explanation: q.explanation,
        outcome_ids: codeToId[q.outcome_code] ? [codeToId[q.outcome_code]] : [],
      }));
      const passCount = Math.ceil(test.questions.length * 0.7);
      test.test_policy = { pass_count: passCount };
      test.content = `Выберите один ответ. Вопросов: ${test.questions.length}; порог: ${passCount} верных ответов. Ключ и объяснение видны методисту.`;
    }
  }
  if (content.final) {
    const { final } = content.final;
    const project = result.find((m) => m.topic_id === 'topic-final');
    if (project) {
      project.title = final.title;
      project.content = [
        final.description,
        'Требования:',
        ...bulletList(final.requirements),
        `Пример задания: ${final.example_task}`,
        'Процедура защиты:',
        ...bulletList(final.procedure),
        `«Зачтено» — от ${final.pass_threshold} баллов из 100.`,
      ].join('\n');
      project.expected = final.requirements.join('; ');
      project.criteria = final.criteria.map(
        (c) => `${c.name} — до ${c.max_points} баллов. ${c.levels}`,
      );
    }
    // Текущий контроль стажировки — собеседование с руководителем по каждому модулю.
    const template = result.find((m) => m.type === 'working_program');
    // Модель иногда присылает вопросы собеседования и для обычной программы.
    if (template && isInternship(skeleton.requirements))
      for (const block of final.interview_questions) {
        const moduleId = modules[block.module - 1];
        const firstTopic = studyTopics(skeleton).find((t) => t.module_id === moduleId);
        if (!firstTopic) continue;
        const id = `mentor_interview-${moduleId}`;
        if (result.some((m) => m.id === id)) continue;
        const topicIds = studyTopics(skeleton)
          .filter((t) => t.module_id === moduleId)
          .map((t) => t.id);
        result.push({
          ...template,
          id,
          module_id: moduleId,
          topic_id: firstTopic.id,
          outcome_ids: [
            ...new Set(
              skeleton.topics.filter((t) => topicIds.includes(t.id)).flatMap((t) => t.outcome_ids),
            ),
          ],
          type: 'mentor_interview',
          title: `Собеседование с руководителем стажировки: ${moduleTitle(skeleton, block.module - 1)}`,
          content: block.questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
          expected: 'Ответы с примерами из выполненных заданий стажировки',
          criteria: ['Объясняет решение на своём примере', 'Называет проверку и возможную ошибку'],
          hash: '',
        });
      }
  }
  return result;
}

// Компактное описание комплекта для самопроверки: модель видит только то, что нужно
// для смысловой проверки, чтобы запрос оставался дешёвым.
export function reviewRequest(skeleton: Skeleton, materials: Material[]) {
  const codes = outcomeCodes(skeleton);
  const { numbers } = topicNumbers(skeleton);
  const test = materials.find((m) => m.type === 'test');
  const final = materials.find((m) => m.topic_id === 'topic-final');
  return {
    title: skeleton.requirements.title,
    goal: skeleton.goal,
    template:
      skeleton.requirements.template_id === 'acr_general'
        ? 'общеразвивающая программа'
        : 'программа повышения квалификации',
    audience: skeleton.requirements.audience,
    entry_level: skeleton.requirements.entry_level,
    total_hours: Number(skeleton.requirements.total_hours),
    constraints: skeleton.requirements.constraints,
    materials: materials.map((m) => ({
      id: m.id,
      type: m.type,
      title: m.title,
      topic_id: m.topic_id,
      content: m.content,
      expected: m.expected,
      criteria: m.criteria,
      slides: m.slides,
    })),
    outcomes: skeleton.outcomes.map((o) => ({
      code: codes[o.id],
      description: o.description,
      criteria: o.criteria ?? [],
    })),
    topics: studyTopics(skeleton).map((t) => ({
      number: numbers.get(t.id)!,
      title: t.title,
      hours: formatHours(t.planned_total),
      outcomes: t.outcome_ids.map((id) => codes[id]),
      summary:
        materials.find((m) => m.topic_id === t.id && m.type === 'working_program')?.content ??
        t.content,
    })),
    questions: (test?.questions ?? []).map((q, i) => ({
      number: i + 1,
      text: q.text,
      options: q.options,
      correct: q.options[q.correct_index] ?? '',
      explanation: q.explanation,
      outcome: q.outcome_ids.map((id) => codes[id]).join(', '),
    })),
    final: final
      ? `${final.title}. ${final.content}\n${final.criteria.join('\n')}`.slice(0, 3000)
      : '',
  };
}
