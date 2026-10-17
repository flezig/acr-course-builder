import { z } from 'zod';
import type { CallUsage, LlmGateway } from '../llm/gateway.ts';
import { LlmError } from '../llm/gateway.ts';
import { chatStructured } from './structured.ts';

// На итоговую аттестацию каркас всегда отводит 2 ч (см. finalHours во фронтенде),
// поэтому число тем подбирается под оставшиеся учебные часы.
const finalHours = 2;
const maxTopics = 24;

export const skeletonInputSchema = z.object({
  request: z.string().trim().min(1).max(8000),
  title: z.string(),
  template_id: z.enum(['acr_general', 'acr_professional', 'unknown']),
  audience: z.string(),
  entry_level: z.string(),
  goal: z.string(),
  total_hours: z.coerce.number().min(16).max(500),
  delivery: z.string(),
  assessment: z.string(),
  constraints: z.string(),
  // Ответы методиста на уточняющие вопросы агента по содержанию.
  answers: z
    .array(z.object({ question: z.string(), answer: z.string().trim().min(1) }))
    .max(10)
    .default([]),
});

export type SkeletonInput = z.infer<typeof skeletonInputSchema>;

// Ответ модели: только смысловая структура. Часов в нём нет — их распределяет код
// по относительной сложности тем, чтобы сумма всегда сходилась с подтверждённым объёмом.
// Схема отвергает только сломанную структуру. Лишняя задача или критерий — не повод
// терять каркас: число результатов и тем проверяет normalizeDesign с понятным замечанием.
const modelAnswerSchema = z.object({
  goal: z.string().min(1),
  tasks: z.array(z.string().min(1)).min(1).max(12),
  outcomes: z
    .array(
      z.object({
        kind: z.enum(['knowledge', 'skill', 'proficiency']),
        title: z.string().min(1),
        description: z.string().min(1),
        criteria: z.array(z.string().min(1)).min(1).max(6),
      }),
    )
    .min(2)
    .max(12),
  // Обоснование для методиста: на что опирается программа и достижима ли цель за объём.
  design_notes: z
    .object({
      entry_basis: z.string().default(''),
      added_basics: z.array(z.string()).default([]),
      realism: z.enum(['achievable', 'partly', 'not_achievable']).catch('partly'),
      realism_reason: z.string().default(''),
      recommendation: z.string().default(''),
    })
    .nullish()
    .transform((value) => value ?? null),
  modules: z
    .array(
      z.object({
        title: z.string().min(1),
        topics: z
          .array(
            z.object({
              title: z.string().min(1),
              content: z.string().min(1),
              profile: z.enum(['intro', 'tool', 'project']),
              weight: z.coerce.number().int().min(1).max(5),
              // Пустое модель иногда передаёт как null — для этих полей это просто «нет».
              weight_reason: z
                .string()
                .nullish()
                .transform((value) => value ?? ''),
              outcomes: z
                .array(z.coerce.number().int())
                .nullish()
                .transform((value) => value ?? []),
              prerequisites: z
                .array(z.coerce.number().int())
                .nullish()
                .transform((value) => value ?? []),
              control: z.string().min(1),
            }),
          )
          // Пустой модуль (модель так оформляет «Итоговую аттестацию») убирает normalizeDesign.
          .min(0),
      }),
    )
    .min(1),
});

const strictObject = (properties: Record<string, object>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const integers = { type: 'array', items: { type: 'integer' } };

// Форма ответа для structured output шлюза; длинный каркас на 256 ч без неё мог
// прийти с битым JSON. Смысловые ограничения проверяют zod и normalizeDesign.
const skeletonJsonSchema = {
  name: 'draft_skeleton',
  schema: strictObject({
    goal: { type: 'string' },
    tasks: { type: 'array', items: { type: 'string' } },
    design_notes: strictObject({
      entry_basis: { type: 'string' },
      added_basics: { type: 'array', items: { type: 'string' } },
      realism: { type: 'string', enum: ['achievable', 'partly', 'not_achievable'] },
      realism_reason: { type: 'string' },
      recommendation: { type: 'string' },
    }),
    outcomes: {
      type: 'array',
      items: strictObject({
        kind: { type: 'string', enum: ['knowledge', 'skill', 'proficiency'] },
        title: { type: 'string' },
        description: { type: 'string' },
        criteria: { type: 'array', items: { type: 'string' } },
      }),
    },
    modules: {
      type: 'array',
      items: strictObject({
        title: { type: 'string' },
        topics: {
          type: 'array',
          items: strictObject({
            title: { type: 'string' },
            content: { type: 'string' },
            profile: { type: 'string', enum: ['intro', 'tool', 'project'] },
            weight: { type: 'integer' },
            weight_reason: { type: 'string' },
            outcomes: integers,
            prerequisites: integers,
            control: { type: 'string' },
          }),
        },
      }),
    },
  }),
};

export interface DesignTopic {
  module: number;
  title: string;
  content: string;
  profile: 'intro' | 'tool' | 'project';
  weight: number;
  weight_reason: string;
  outcomes: number[];
  prerequisites: number[];
  control: string;
}

export interface CourseDesign {
  goal: string;
  tasks: string[];
  module_titles: string[];
  outcomes: z.infer<typeof modelAnswerSchema>['outcomes'];
  topics: DesignTopic[];
  design_notes: z.infer<typeof modelAnswerSchema>['design_notes'];
  generated_by: CallUsage;
}

// Сколько результатов реалистично сформировать за объём: на 16 ч — 3–4,
// на 72 ч — 4–7, на 256 ч — 6–10. Знаний на больших программах нужно больше одного.
export function outcomeRange(totalHours: number) {
  if (totalHours <= 24) return { min: 3, max: 4, knowledge: 1 };
  if (totalHours <= 48) return { min: 3, max: 6, knowledge: 1 };
  if (totalHours <= 100) return { min: 4, max: 7, knowledge: 2 };
  if (totalHours <= 200) return { min: 5, max: 9, knowledge: 2 };
  return { min: 6, max: 10, knowledge: 3 };
}

// Тема не короче 2 ч (в образце интенсива АЦР на 24 ч темы по 2–3 ч) и не длиннее ~12 ч.
export function topicRange(totalHours: number) {
  const study = totalHours - finalHours;
  const min = Math.min(maxTopics, Math.max(3, Math.ceil(study / 12)));
  return { min, max: Math.min(maxTopics, Math.max(min, Math.floor(study / 2))) };
}

function instructions(input: SkeletonInput) {
  const range = topicRange(input.total_hours);
  const outcomes = outcomeRange(input.total_hours);
  const template =
    input.template_id === 'acr_professional'
      ? 'дополнительная профессиональная программа повышения квалификации (результаты связаны с профессиональными действиями слушателей)'
      : input.template_id === 'acr_general'
        ? 'дополнительная общеразвивающая программа'
        : 'тип программы не уточнён';
  return `Ты методист Академии цифрового развития. Спроектируй каркас образовательной программы: цель, задачи, результаты обучения, модули и темы.
Тип: ${template}.

Правила:
- Результаты обучения: от ${outcomes.min} до ${outcomes.max} — столько реально сформировать за ${input.total_hours} ч у слушателей с таким входным уровнем; не меньше ${outcomes.knowledge} результатов-знаний. Формулировки по образцам АЦР:
  • knowledge — «Знает …»: конкретные понятия, методы, алгоритмы, инструменты, которые слушатель сможет перечислить и сравнить (например, «Знает алгоритмы обучения с учителем: линейную и логистическую регрессию, деревья решений, k-ближайших соседей; признаки переобучения»). Не пиши общих формулировок вроде «Описывает, что такое …».
  • skill — «Умеет …»: измеримое действие с инструментом или методом на конкретной задаче.
  • proficiency — «Владеет …»: целостный рабочий приём или опыт, который слушатель покажет в итоговой работе.
  Для каждого результата дай 1–2 критерия, по которым преподаватель проверит его достижение.
- Входной уровень: не учи тому, что слушатели уже знают, а опирайся на это; если для цели не хватает базы (например, математической статистики), добавь вводные темы. Глубина результатов должна быть достижима за объём программы.
- design_notes — объяснение для методиста: entry_basis — на какие знания слушателей программа опирается и что поэтому не включено; added_basics — какие базовые темы добавлены из-за входного уровня (пустой список, если не нужны); realism — achievable, partly или not_achievable: достижима ли цель запроса за этот объём при этом входном уровне; realism_reason — почему, с цифрами часов; recommendation — если цель достижима не полностью: что предложить методисту (увеличить объём до N ч или сузить цель до …), иначе пустая строка.
- Модули (от 2 до 6) объединяют темы по смыслу. Всего тем от ${range.min} до ${range.max}, итоговую аттестацию темой не добавляй — она будет отдельно.
- Для темы: content — что изучают и что делают на занятии (до 200 символов); profile — intro (вводная, больше объяснения), tool (отработка инструмента, больше практики), project (проектная работа); weight — относительная трудоёмкость от 1 до 5 и weight_reason — короткое обоснование; outcomes — номера результатов (с 1), которые тема формирует; prerequisites — номера предыдущих тем (сквозная нумерация с 1), без которых тему не освоить; control — форма текущего контроля.
- Каждый результат должен формироваться хотя бы одной темой.
- Часы не указывай: их распределит программа по трудоёмкости тем.
- Ответы методиста на уточняющие вопросы обязательны: инструменты, данные, проект и акценты из ответов должны прямо отразиться в темах и результатах.
- Не выдумывай нормативные документы, профстандарты, авторов и ссылки.

Верни только JSON без пояснений и Markdown:
{"goal": "...", "tasks": ["..."], "design_notes": {"entry_basis": "...", "added_basics": [], "realism": "achievable", "realism_reason": "...", "recommendation": ""}, "outcomes": [{"kind": "skill", "title": "...", "description": "...", "criteria": ["..."]}], "modules": [{"title": "...", "topics": [{"title": "...", "content": "...", "profile": "tool", "weight": 3, "weight_reason": "...", "outcomes": [1], "prerequisites": [], "control": "..."}]}]}`;
}

function brief(input: SkeletonInput) {
  return [
    `Запрос методиста: ${input.request}`,
    `Название: ${input.title}`,
    `Аудитория: ${input.audience || 'не указана'}`,
    `Входной уровень: ${input.entry_level || 'не указан'}`,
    `Цель из сводки: ${input.goal || 'не указана'}`,
    `Объём: ${input.total_hours} ч, из них ${finalHours} ч — итоговая аттестация`,
    `Форма обучения: ${input.delivery || 'не указана'}`,
    `Итоговая аттестация: ${input.assessment || 'не указана'}`,
    `Ограничения: ${input.constraints || 'нет'}`,
    ...(input.answers.length
      ? [
          'Ответы методиста на уточняющие вопросы:',
          ...input.answers.map(({ question, answer }) => `- ${question} — ${answer}`),
        ]
      : []),
  ].join('\n');
}

export async function draftSkeleton(gateway: LlmGateway, input: SkeletonInput) {
  const { data, usage } = await chatStructured(
    gateway,
    'draft_skeleton',
    [
      { role: 'system', content: instructions(input) },
      { role: 'user', content: brief(input) },
    ],
    skeletonJsonSchema,
    modelAnswerSchema,
    'Модель вернула каркас не по схеме. Попробуйте ещё раз.',
  );
  const { design, issues } = normalizeDesign(data, input.total_hours);
  const result: { design: CourseDesign; issues: string[] } = {
    design: { ...design, generated_by: usage },
    issues,
  };
  return result;
}

// Итоговую аттестацию каркас добавляет сам с фиксированными часами,
// а модель, несмотря на инструкцию, иногда предлагает её отдельным модулем или темой.
const finalAssessmentTitle =
  /итогов[а-яё]*\s+аттестац|защит[а-яё]*\s+(итогов|выпускн)|итогов[а-яё]*\s+(проект|экзамен|зач[её]т|тест)/i;

// Код не доверяет ссылкам модели: убирает несуществующие номера и зависимости «вперёд»
// и сообщает, какие результаты остались без тем, а не скрывает это.
export function normalizeDesign(answer: z.infer<typeof modelAnswerSchema>, totalHours: number) {
  const issues: string[] = [];
  const numbered = answer.modules.flatMap((module) =>
    module.topics.map((topic) => ({ topic, module })),
  );
  // Модуль «Проект и итоговая аттестация» остаётся, если в нём есть учебные темы:
  // убирается только тема самой аттестации.
  const keptModules = answer.modules.filter((module) =>
    module.topics.some((topic) => !finalAssessmentTitle.test(topic.title)),
  );
  const kept = numbered.filter(
    ({ topic, module }) => keptModules.includes(module) && !finalAssessmentTitle.test(topic.title),
  );
  if (kept.length < numbered.length)
    issues.push('Итоговую аттестацию модель предложила темой; она убрана, её часы задаёт код.');
  // Номера тем модели сквозные по исходному ответу, поэтому после удаления их нужно перенумеровать.
  const renumbered = new Map(
    kept.map(({ topic }, index) => [
      numbered.findIndex((item) => item.topic === topic) + 1,
      index + 1,
    ]),
  );
  const topics: DesignTopic[] = kept.map(({ topic, module }, index) => {
    const outcomes = topic.outcomes.filter((n) => n >= 1 && n <= answer.outcomes.length);
    const prerequisites = topic.prerequisites
      .map((n) => renumbered.get(n))
      .filter((n): n is number => n !== undefined && n <= index);
    if (
      outcomes.length !== topic.outcomes.length ||
      prerequisites.length !== topic.prerequisites.length
    )
      issues.push(
        `В теме «${topic.title}» убраны ссылки на несуществующие результаты или более поздние темы.`,
      );
    return {
      ...topic,
      module: keptModules.indexOf(module) + 1,
      outcomes: [...new Set(outcomes)],
      prerequisites: [...new Set(prerequisites)],
    };
  });
  if (!topics.length) throw new LlmError('empty', 'Модель не предложила ни одной учебной темы.');
  if (topics.length > maxTopics)
    throw new LlmError('empty', `Модель предложила ${topics.length} тем — больше ${maxTopics}.`);
  if (topics.length > totalHours - finalHours)
    throw new LlmError('empty', 'Тем больше, чем учебных часов. Попробуйте ещё раз.');
  const range = topicRange(totalHours);
  if (topics.length < range.min || topics.length > range.max)
    issues.push(
      `Модель предложила ${topics.length} тем, для ${totalHours} ч ожидалось ${range.min}–${range.max}; объём тем проверьте.`,
    );
  // Результат, который не формирует ни одна тема, нельзя ни освоить, ни проверить:
  // он убирается из каркаса, а номера результатов в темах пересчитываются.
  const formed = answer.outcomes.flatMap((outcome, index) => {
    if (topics.some((topic) => topic.outcomes.includes(index + 1))) return [index + 1];
    issues.push(`Результат «${outcome.title}» не формирует ни одна тема — убран из каркаса.`);
    return [];
  });
  if (formed.length < 2)
    throw new LlmError('empty', 'Темы формируют меньше двух результатов. Попробуйте ещё раз.');
  const expected = outcomeRange(totalHours);
  if (formed.length < expected.min || formed.length > expected.max)
    issues.push(
      `Результатов обучения ${formed.length}, для ${totalHours} ч обычно ${expected.min}–${expected.max}: проверьте, не слишком ли ${formed.length < expected.min ? 'узко' : 'много'} для объёма.`,
    );
  const knowledge = formed.filter((n) => answer.outcomes[n - 1].kind === 'knowledge').length;
  if (knowledge < expected.knowledge)
    issues.push(
      `Результатов-знаний ${knowledge}, для ${totalHours} ч нужно не меньше ${expected.knowledge}: добавьте, какие методы и понятия слушатель будет знать.`,
    );
  const outcomeNumber = new Map(formed.map((number, index) => [number, index + 1]));
  return {
    design: {
      goal: answer.goal,
      tasks: answer.tasks,
      design_notes: answer.design_notes,
      module_titles: keptModules.map((module) => module.title),
      outcomes: formed.map((number) => answer.outcomes[number - 1]),
      topics: topics.map((topic) => ({
        ...topic,
        outcomes: topic.outcomes.map((number) => outcomeNumber.get(number)!),
      })),
    },
    issues,
  };
}
