import { z } from 'zod';
import type { CallUsage, LlmGateway } from '../llm/gateway.ts';
import { chatStructured } from './structured.ts';

// Материалы генерируются после утверждения каркаса по частям: тема за вызов, отдельно тест
// и итоговая аттестация. Так ответ укладывается в max_tokens шлюза (4096), а ошибка одной
// темы не теряет остальные. Структуру, часы и связи задаёт утверждённый каркас, модель пишет
// только текст внутри неё.

const hoursSchema = z.object({
  lecture: z.coerce.number().min(0),
  practice: z.coerce.number().min(0),
  lab: z.coerce.number().min(0),
  self_study: z.coerce.number().min(0),
});

export const courseBriefSchema = z.object({
  title: z.string().min(1),
  template_id: z.enum(['acr_general', 'acr_professional', 'unknown']),
  audience: z.string(),
  entry_level: z.string(),
  goal: z.string(),
  delivery: z.string(),
  assessment: z.string(),
  internship: z.boolean().default(false),
  outcomes: z
    .array(z.object({ code: z.string().min(1), kind: z.string(), description: z.string() }))
    .min(1)
    .max(20),
  // Ответы методиста на уточняющие вопросы: инструменты, данные, проект.
  answers: z.array(z.string()).max(10).default([]),
});

export type CourseBrief = z.infer<typeof courseBriefSchema>;

export const topicInputSchema = z.object({
  brief: courseBriefSchema,
  module_title: z.string(),
  topic: z.object({
    id: z.string().min(1),
    number: z.string().min(1),
    title: z.string().min(1),
    content: z.string(),
    hours: hoursSchema,
    outcome_codes: z.array(z.string()),
    control: z.string(),
  }),
  previous_topics: z.array(z.string()).max(30).default([]),
});

export type TopicInput = z.infer<typeof topicInputSchema>;

// JSON-схемы для structured output шлюза. Они задают только форму ответа;
// смысловые ограничения (число пунктов, ключи, баллы) проверяют zod-схемы и код ниже.
const strings = { type: 'array', items: { type: 'string' } } as const;
const object = (properties: Record<string, object>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const topicJsonSchema = {
  name: 'topic_materials',
  schema: object({
    lecture_points: strings,
    practice: { anyOf: [object({ title: { type: 'string' }, points: strings }), { type: 'null' }] },
    self_study_points: strings,
    slides: {
      type: 'array',
      items: object({ title: { type: 'string' }, bullets: strings, notes: { type: 'string' } }),
    },
    seminar: object({
      title: { type: 'string' },
      task: { type: 'string' },
      steps: strings,
      expected: { type: 'string' },
      criteria: strings,
    }),
    control_questions: strings,
  }),
};

const testJsonSchema = {
  name: 'course_test',
  schema: object({
    questions: {
      type: 'array',
      items: object({
        text: { type: 'string' },
        options: strings,
        correct: { type: 'integer' },
        explanation: { type: 'string' },
        outcome: { type: 'string' },
      }),
    },
  }),
};

const finalJsonSchema = {
  name: 'final_assessment',
  schema: object({
    title: { type: 'string' },
    description: { type: 'string' },
    requirements: strings,
    example_task: { type: 'string' },
    criteria: {
      type: 'array',
      items: object({
        name: { type: 'string' },
        max_points: { type: 'integer' },
        levels: { type: 'string' },
      }),
    },
    pass_threshold: { type: 'integer' },
    procedure: strings,
    interview_questions: {
      type: 'array',
      items: object({ module: { type: 'integer' }, questions: strings }),
    },
  }),
};

const text = z.string().trim().min(1);
const list = (min: number, max: number) =>
  z
    .array(text)
    .min(min)
    // Лишние пункты не повод терять ответ: код оставляет первые max.
    .transform((items) => items.slice(0, max));

const topicAnswerSchema = z.object({
  lecture_points: list(0, 8)
    .nullish()
    .transform((value) => value ?? []),
  practice: z
    .object({ title: text, points: list(1, 8) })
    .nullish()
    .transform((value) => value ?? null),
  self_study_points: list(0, 8)
    .nullish()
    .transform((value) => value ?? []),
  slides: z
    .array(z.object({ title: text, bullets: list(1, 6), notes: z.string().default('') }))
    .nullish()
    .transform((value) => (value ?? []).slice(0, 8)),
  seminar: z.object({
    title: text,
    task: text,
    steps: list(1, 8),
    expected: text,
    criteria: list(1, 5),
  }),
  control_questions: list(0, 5)
    .nullish()
    .transform((value) => value ?? []),
});

export type TopicMaterials = z.infer<typeof topicAnswerSchema>;

function templateLabel(brief: CourseBrief) {
  if (brief.template_id === 'acr_general')
    return 'дополнительная общеразвивающая программа (простой язык, термины поясняются при первом упоминании)';
  return brief.internship
    ? 'программа повышения квалификации в форме стажировки: вся учебная работа — самостоятельная под руководством наставника'
    : 'дополнительная профессиональная программа повышения квалификации';
}

function briefText(brief: CourseBrief) {
  return [
    `Программа: «${brief.title}» — ${templateLabel(brief)}.`,
    `Слушатели: ${brief.audience || 'не указаны'}; входной уровень: ${brief.entry_level || 'не указан'}.`,
    `Цель: ${brief.goal}`,
    `Форма обучения: ${brief.delivery || 'не указана'}; итоговая аттестация: ${brief.assessment || 'не указана'}.`,
    'Результаты обучения:',
    ...brief.outcomes.map((o) => `${o.code} — ${o.description}`),
    ...(brief.answers.length
      ? ['Уточнения методиста:', ...brief.answers.map((a) => `- ${a}`)]
      : []),
  ].join('\n');
}

const commonRules = `- Пиши по-русски, конкретно для этих слушателей и этой темы, без общих фраз.
- Не выдумывай нормативные документы, профстандарты, авторов, книги и ссылки. Инструменты называй только реально существующие и доступные в России.
- Учебные данные — только синтетические или обезличенные.`;

function topicInstructions(input: TopicInput) {
  const { hours } = input.topic;
  const hasLecture = hours.lecture > 0;
  const hasPractice = hours.practice + hours.lab > 0;
  return `Ты методист Академии цифрового развития. Напиши содержание одной темы утверждённой программы для рабочей программы и комплекта материалов.

Часы темы утверждены и не меняются: лекции ${hours.lecture} ч, практика ${hours.practice} ч, лабораторные ${hours.lab} ч, самостоятельная работа ${hours.self_study} ч.

Поля ответа:
- lecture_points: ${hasLecture ? '3–6 пунктов теории для лекции (что объясняется)' : 'пустой список: лекций в теме нет'};
- practice: ${hasPractice ? 'практикум: title — название в кавычках-ёлочках по образцу «Практикум „…“», points — 2–6 конкретных действий слушателя с измеримым результатом (например, «зафиксировать 10+ требований в таблице»)' : 'null: аудиторной практики нет'};
- self_study_points: ${hours.self_study > 0 ? '2–5 пунктов самостоятельной работы' : 'пустой список'};
- slides: ${hasLecture || input.brief.internship ? '3–5 слайдов для преподавателя или наставника: title, bullets (2–5 коротких тезисов), notes — что сказать и какой вопрос задать слушателям' : 'пустой список'};
- seminar: практическое задание по теме: title, task — условие с исходными данными, steps — шаги выполнения, expected — что сдаёт слушатель, criteria — 2–4 проверяемых критерия оценки;
- control_questions: 2–3 вопроса для текущего контроля${input.brief.internship ? ' (собеседование с руководителем стажировки)' : ''}.

Правила:
${commonRules}
- Тема опирается только на предыдущие темы программы; не забегай вперёд.

Верни только JSON без пояснений и Markdown:
{"lecture_points": ["..."], "practice": {"title": "...", "points": ["..."]}, "self_study_points": ["..."], "slides": [{"title": "...", "bullets": ["..."], "notes": "..."}], "seminar": {"title": "...", "task": "...", "steps": ["..."], "expected": "...", "criteria": ["..."]}, "control_questions": ["..."]}`;
}

function topicBrief(input: TopicInput) {
  return [
    briefText(input.brief),
    '',
    `Модуль: ${input.module_title}`,
    `Тема ${input.topic.number}. ${input.topic.title}`,
    `Содержание из каркаса: ${input.topic.content}`,
    `Формирует результаты: ${input.topic.outcome_codes.join(', ') || 'не указаны'}`,
    `Текущий контроль: ${input.topic.control}`,
    input.previous_topics.length
      ? `Предыдущие темы: ${input.previous_topics.join('; ')}`
      : 'Это первая тема программы.',
  ].join('\n');
}

export async function generateTopicMaterials(gateway: LlmGateway, input: TopicInput) {
  const { data, usage } = await chatStructured(
    gateway,
    'topic_materials',
    [
      { role: 'system', content: topicInstructions(input) },
      { role: 'user', content: topicBrief(input) },
    ],
    topicJsonSchema,
    topicAnswerSchema,
    `Модель вернула материалы темы «${input.topic.title}» не по схеме. Повторите генерацию темы.`,
  );
  const materials = data;
  // Слайды и пункты лекции без лекционных часов не нужны: их часы утверждены в каркасе.
  if (input.topic.hours.lecture === 0) materials.lecture_points = [];
  if (input.topic.hours.lecture === 0 && !input.brief.internship) materials.slides = [];
  if (input.topic.hours.practice + input.topic.hours.lab === 0) materials.practice = null;
  return { topic_id: input.topic.id, materials, usage } satisfies {
    topic_id: string;
    materials: TopicMaterials;
    usage: CallUsage;
  };
}

export const testInputSchema = z.object({
  brief: courseBriefSchema,
  topics: z
    .array(z.object({ number: z.string(), title: z.string() }))
    .min(1)
    .max(40),
  question_count: z.number().int().min(5).max(20),
});

export type TestInput = z.infer<typeof testInputSchema>;

const questionAnswerSchema = z.object({
  questions: z
    .array(
      z.object({
        text,
        options: z.array(text).min(3).max(5),
        correct: z.coerce.number().int(),
        explanation: text,
        outcome: text,
      }),
    )
    .min(1),
});

export interface TestQuestion {
  text: string;
  options: string[];
  correct_index: number;
  explanation: string;
  outcome_code: string;
}

export async function generateCourseTest(gateway: LlmGateway, input: TestInput) {
  const codes = input.brief.outcomes.map((o) => o.code);
  const { data, usage } = await chatStructured(
    gateway,
    'course_test',
    [
      {
        role: 'system',
        content: `Ты методист Академии цифрового развития. Составь итоговый тест по программе: ровно ${input.question_count} вопросов с одним верным ответом.

Правила:
${commonRules}
- Каждый вопрос проверяет один результат обучения; outcome — его код (${codes.join(', ')}). Каждый результат проверяется хотя бы одним вопросом, вопросы распредели между результатами примерно поровну.
- 4 варианта ответа, правдоподобные неверные варианты; correct — номер верного варианта с 1. Верный ответ ставь в разные позиции.
- explanation — почему ответ верный, одним-двумя предложениями.
- Вопросы проверяют понимание и применение (ситуация → что сделать), а не дословное воспроизведение терминов.

Верни только JSON без пояснений и Markdown:
{"questions": [{"text": "...", "options": ["...", "...", "...", "..."], "correct": 2, "explanation": "...", "outcome": "${codes[0]}"}]}`,
      },
      {
        role: 'user',
        content: [
          briefText(input.brief),
          '',
          'Темы программы:',
          ...input.topics.map((t) => `${t.number}. ${t.title}`),
        ].join('\n'),
      },
    ],
    testJsonSchema,
    questionAnswerSchema,
    'Модель вернула тест не по схеме. Повторите генерацию теста.',
  );
  return { ...normalizeQuestions(data.questions, codes, input.question_count), usage };
}

// Код не доверяет ключам модели: номер ответа должен существовать, варианты — различаться,
// код результата — быть из программы. Такие вопросы отбрасываются с объяснением.
export function normalizeQuestions(
  questions: z.infer<typeof questionAnswerSchema>['questions'],
  codes: string[],
  expected: number,
) {
  const issues: string[] = [];
  const result: TestQuestion[] = [];
  for (const [index, question] of questions.entries()) {
    const options = question.options.map((option) => option.trim());
    const outcome = codes.find((code) => question.outcome.includes(code));
    if (question.correct < 1 || question.correct > options.length)
      issues.push(`Вопрос ${index + 1}: ключ указывает на несуществующий вариант — вопрос убран.`);
    else if (new Set(options.map((o) => o.toLowerCase())).size !== options.length)
      issues.push(`Вопрос ${index + 1}: варианты ответа повторяются — вопрос убран.`);
    else if (!outcome)
      issues.push(
        `Вопрос ${index + 1}: результат «${question.outcome}» не из программы — вопрос убран.`,
      );
    else
      result.push({
        text: question.text,
        options,
        correct_index: question.correct - 1,
        explanation: question.explanation,
        outcome_code: outcome,
      });
  }
  const kept = result.slice(0, expected);
  if (kept.length < expected)
    issues.push(`В тесте ${kept.length} вопросов из ${expected}; недостающие добавьте вручную.`);
  for (const code of codes)
    if (!kept.some((q) => q.outcome_code === code))
      issues.push(`Результат ${code} не проверяется ни одним вопросом теста.`);
  return { questions: kept, issues };
}

export const finalInputSchema = z.object({
  brief: courseBriefSchema,
  modules: z
    .array(z.object({ title: z.string(), topics: z.array(z.string()).min(1) }))
    .min(1)
    .max(12),
});

export type FinalInput = z.infer<typeof finalInputSchema>;

const finalAnswerSchema = z.object({
  title: text,
  description: text,
  requirements: list(1, 10),
  example_task: text,
  criteria: z
    .array(
      z.object({ name: text, max_points: z.coerce.number().int().min(1).max(100), levels: text }),
    )
    .min(2)
    .max(6),
  pass_threshold: z.coerce.number().int().min(1).max(100),
  procedure: list(1, 6),
  interview_questions: z
    .array(z.object({ module: z.coerce.number().int().min(1), questions: list(1, 6) }))
    .nullish()
    .transform((value) => value ?? []),
});

export type FinalAssessment = z.infer<typeof finalAnswerSchema>;

export async function generateFinalAssessment(gateway: LlmGateway, input: FinalInput) {
  const internship = input.brief.internship;
  const { data, usage } = await chatStructured(
    gateway,
    'final_assessment',
    [
      {
        role: 'system',
        content: `Ты методист Академии цифрового развития. Опиши оценочные материалы итоговой аттестации программы по образцу АЦР («Методические указания к подготовке итоговой аттестации»).

Форма итоговой аттестации задана методистом: ${input.brief.assessment || 'защита итогового проекта'}. Не меняй её.

Поля ответа:
- title — название итоговой работы${internship ? ' (отчёт о стажировке и его защита)' : ''};
- description — что слушатель делает и представляет;
- requirements — требования к работе или отчёту: состав артефактов, данные, оформление;
- example_task — пример задания${input.brief.template_id === 'acr_general' ? ' простыми словами для подростка' : ''};
- criteria — 3–5 критериев: name, max_points (сумма ровно 100), levels — что даёт низкий, средний и высокий балл;
- pass_threshold — проходной балл из 100;
- procedure — порядок защиты: длительность выступления, ответы на вопросы;
- interview_questions — ${internship ? 'для каждого модуля (module — номер с 1) 3–5 вопросов собеседования с руководителем стажировки для текущего контроля' : 'пустой список'}.

Правила:
${commonRules}
- Каждый результат обучения должен проверяться хотя бы одним критерием или требованием.

Верни только JSON без пояснений и Markdown:
{"title": "...", "description": "...", "requirements": ["..."], "example_task": "...", "criteria": [{"name": "...", "max_points": 40, "levels": "..."}], "pass_threshold": 70, "procedure": ["..."], "interview_questions": [{"module": 1, "questions": ["..."]}]}`,
      },
      {
        role: 'user',
        content: [
          briefText(input.brief),
          '',
          'Модули программы:',
          ...input.modules.map((m, i) => `${i + 1}. ${m.title}: ${m.topics.join('; ')}`),
        ].join('\n'),
      },
    ],
    finalJsonSchema,
    finalAnswerSchema,
    'Модель вернула итоговую аттестацию не по схеме. Повторите генерацию.',
  );
  const issues: string[] = [];
  const final = data;
  const total = final.criteria.reduce((sum, c) => sum + c.max_points, 0);
  // Баллы по критериям складывает код: при расхождении шкала приводится к 100 пропорционально.
  if (total !== 100) {
    issues.push(`Сумма баллов критериев была ${total}, приведена к 100.`);
    let rest = 100;
    final.criteria.forEach((criterion, index) => {
      criterion.max_points =
        index === final.criteria.length - 1
          ? rest
          : Math.max(1, Math.round((criterion.max_points / total) * 100));
      rest -= criterion.max_points;
    });
  }
  if (final.pass_threshold > 90 || final.pass_threshold < 50) {
    issues.push(`Проходной балл ${final.pass_threshold} заменён на 70.`);
    final.pass_threshold = 70;
  }
  // Собеседование с руководителем — текущий контроль только стажировки.
  final.interview_questions = internship
    ? final.interview_questions.filter((block) => block.module <= input.modules.length)
    : [];
  if (internship)
    input.modules.forEach((module, index) => {
      if (!final.interview_questions.some((block) => block.module === index + 1))
        issues.push(`Для модуля «${module.title}» нет вопросов собеседования.`);
    });
  return { final, issues, usage };
}

export const repairInputSchema = z.object({
  brief: courseBriefSchema,
  // Вопросы, к которым самопроверка нашла ошибку: заменяются целиком.
  replace: z
    .array(
      z.object({
        number: z.number().int().min(1),
        text: z.string(),
        options: z.array(z.string()),
        correct: z.string(),
        outcome: z.string(),
        problem: z.string(),
      }),
    )
    .max(20),
  // Результаты, которые тест не проверяет: для каждого нужен новый вопрос.
  add: z.array(z.string()).max(20),
});

export type RepairInput = z.infer<typeof repairInputSchema>;

// Доработка по итогам самопроверки: модель переписывает только отмеченные вопросы
// и добавляет вопросы по непокрытым результатам; остальной тест не трогается.
export async function repairTest(gateway: LlmGateway, input: RepairInput) {
  const codes = input.brief.outcomes.map((o) => o.code);
  const expected = input.replace.length + input.add.length;
  const { data, usage } = await chatStructured(
    gateway,
    'test_repair',
    [
      {
        role: 'system',
        content: `Ты методист Академии цифрового развития. Исправь вопросы итогового теста по замечаниям проверки и добавь недостающие.

Верни ровно ${expected} вопросов в таком порядке: сначала исправленные версии вопросов из списка «Исправить» (в том же порядке, с тем же результатом обучения), затем по одному новому вопросу на каждый результат из списка «Добавить».

Правила:
${commonRules}
- 4 варианта ответа, ровно один верный; correct — номер верного варианта с 1.
- outcome — код результата обучения (${codes.join(', ')}).
- explanation — почему ответ верный.

Верни только JSON без пояснений и Markdown:
{"questions": [{"text": "...", "options": ["...", "...", "...", "..."], "correct": 1, "explanation": "...", "outcome": "${codes[0]}"}]}`,
      },
      {
        role: 'user',
        content: [
          briefText(input.brief),
          '',
          'Исправить:',
          ...(input.replace.length
            ? input.replace.map(
                (q) =>
                  `Вопрос ${q.number} (${q.outcome}): ${q.text} Варианты: ${q.options.join('; ')}. Ключ: ${q.correct}. Замечание: ${q.problem}`,
              )
            : ['нет']),
          'Добавить вопросы по результатам:',
          input.add.length ? input.add.join(', ') : 'нет',
        ].join('\n'),
      },
    ],
    testJsonSchema,
    questionAnswerSchema,
    'Модель вернула исправленный тест не по схеме.',
  );
  const { questions } = normalizeQuestions(data.questions, codes, expected);
  return { questions, usage };
}

export const sectionsInputSchema = z.object({
  brief: courseBriefSchema,
  topics: z.array(z.string()).min(1).max(40),
});

export type SectionsInput = z.infer<typeof sectionsInputSchema>;

const sectionsAnswerSchema = z.object({
  relevance: text,
  methodical: text,
  organization: text,
  environment: list(1, 12),
  literature: z
    .array(
      z.object({
        group: z.enum(['main', 'additional', 'internet']).catch('additional'),
        citation: text,
      }),
    )
    .transform((items) => items.slice(0, 12)),
});

export type ProgramSections = z.infer<typeof sectionsAnswerSchema>;

const sectionsJsonSchema = {
  name: 'program_sections',
  schema: object({
    relevance: { type: 'string' },
    methodical: { type: 'string' },
    organization: { type: 'string' },
    environment: strings,
    literature: {
      type: 'array',
      items: object({
        group: { type: 'string', enum: ['main', 'additional', 'internet'] },
        citation: { type: 'string' },
      }),
    },
  }),
};

// Текстовые разделы программы по образцам АЦР. Литературу модель только предлагает:
// в программе она идёт с пометкой «не подтверждён», пока методист не проверит издание.
export async function generateProgramSections(gateway: LlmGateway, input: SectionsInput) {
  const { data, usage } = await chatStructured(
    gateway,
    'program_sections',
    [
      {
        role: 'system',
        content: `Ты методист Академии цифрового развития. Напиши текстовые разделы программы по образцам АЦР.

Поля ответа:
- relevance — «Актуальность»: 3–5 предложений, почему программа нужна этим слушателям сейчас;
- methodical — «Методические рекомендации»: как вести занятия (соотношение теории и практики, разбор примеров, обратная связь, работа с ошибками), 4–6 предложений;
- organization — «Организация образовательного процесса»: формат занятий${input.brief.internship ? ', роль руководителя стажировки и наставника, отчётность' : ''}, использование ЭО и ДОТ, 3–5 предложений;
- environment — программное обеспечение и сервисы для занятий с версиями, только существующие и доступные в России;
- literature — 4–8 источников: group — main (основная литература), additional (дополнительная) или internet (интернет-ресурсы, официальная документация); citation — библиографическая запись. Предлагай только книги и документацию, в существовании которых уверен; источники проверит методист.

Правила:
${commonRules}

Верни только JSON без пояснений и Markdown.`,
      },
      {
        role: 'user',
        content: [briefText(input.brief), '', 'Темы:', ...input.topics.map((t) => `- ${t}`)].join(
          '\n',
        ),
      },
    ],
    sectionsJsonSchema,
    sectionsAnswerSchema,
    'Модель вернула разделы программы не по схеме. Повторите генерацию.',
  );
  return { sections: data, usage };
}
