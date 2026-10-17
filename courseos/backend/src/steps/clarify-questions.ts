import { z } from 'zod';
import type { CallUsage, LlmGateway } from '../llm/gateway.ts';
import { LlmError } from '../llm/gateway.ts';
import { extractJson } from './parse-request.ts';

// Поля сводки (тип, объём, уровень, форма, аттестация) спрашивает само приложение,
// поэтому модель задаёт только содержательные вопросы, от которых зависят темы и задания.
export const questionsInputSchema = z.object({
  request: z.string().trim().min(1).max(8000),
  title: z.string(),
  template_id: z.enum(['acr_general', 'acr_professional', 'unknown']),
  audience: z.string(),
  entry_level: z.string(),
  goal: z.string(),
  total_hours: z.string(),
  delivery: z.string(),
  assessment: z.string(),
  constraints: z.string(),
});

export type QuestionsInput = z.infer<typeof questionsInputSchema>;

const maxQuestions = 4;

const modelAnswerSchema = z.object({
  questions: z
    .array(
      z.object({
        label: z.string().min(1),
        reason: z.string().min(1),
        options: z.array(z.string().min(1)).min(2).max(4),
        recommended: z.string(),
      }),
    )
    .max(6),
});

export interface ClarifyingQuestion {
  id: string;
  label: string;
  reason: string;
  options: string[];
  recommended: string;
}

const instructions = `Ты методист Академии цифрового развития. До проектирования программы ты задаёшь методисту уточняющие вопросы по содержанию.

Спрашивай только то, от чего зависят темы, практические задания или итоговая работа и чего нет в запросе: например, какие инструменты и версии использовать, на каких данных или задачах учиться, какой итоговый проект делать, где слушатели выполняют практику, на чём сделать акцент.
Не спрашивай про тип программы, объём в часах, входной уровень, форму обучения, итоговую аттестацию (ни про её форму, ни про формат: проект, тест, экзамен), сроки и расписание — это уточняется отдельно.
Если запрос и так достаточно конкретен, верни пустой список. Не больше ${maxQuestions} вопросов.

Для каждого вопроса: label — сам вопрос; reason — одно предложение, что в программе изменится от ответа; options — 2–4 коротких варианта ответа; recommended — вариант из options, который ты советуешь для этой аудитории.

Верни только JSON без пояснений и Markdown:
{"questions": [{"label": "...", "reason": "...", "options": ["...", "..."], "recommended": "..."}]}`;

function brief(input: QuestionsInput) {
  return [
    `Запрос методиста: ${input.request}`,
    `Название: ${input.title || 'не указано'}`,
    `Аудитория: ${input.audience || 'не указана'}`,
    `Входной уровень: ${input.entry_level || 'не указан'}`,
    `Цель: ${input.goal || 'не указана'}`,
    `Объём: ${input.total_hours ? `${input.total_hours} ч` : 'не указан'}`,
    `Итоговая аттестация: ${input.assessment || 'не указана'}`,
    `Ограничения: ${input.constraints || 'нет'}`,
  ].join('\n');
}

export async function clarifyQuestions(gateway: LlmGateway, input: QuestionsInput) {
  const { content, usage } = await gateway.chat('clarify_questions', [
    { role: 'system', content: instructions },
    { role: 'user', content: brief(input) },
  ]);
  const parsed = modelAnswerSchema.safeParse(extractJson(content));
  if (!parsed.success)
    throw new LlmError('empty', 'Модель вернула вопросы не по схеме. Попробуйте ещё раз.');
  return { questions: normalizeQuestions(parsed.data.questions), usage } satisfies {
    questions: ClarifyingQuestion[];
    usage: CallUsage;
  };
}

// Устойчивые id нужны, чтобы ответ хранился под вопросом и при повторном открытии формы.
// Рекомендация обязана быть одним из вариантов, иначе экран не сможет её отметить.
// Эти поля приложение спрашивает само; модель, несмотря на инструкцию, иногда дублирует их.
const summaryFieldQuestion =
  /аттестац|экзамен|зач[её]т|объ[её]м|сколько час|форм[аеуы] обучени|(?:^|[^а-яё])(?:за)?очн|дистанц|входн[а-яё]* уровень|тип программ|повышени[ея] квалификаци|общеразвива|срок|недел|расписани/i;

export function normalizeQuestions(
  questions: z.infer<typeof modelAnswerSchema>['questions'],
): ClarifyingQuestion[] {
  const content = questions.filter((question) => !summaryFieldQuestion.test(question.label));
  return content.slice(0, maxQuestions).map((question, index) => {
    const options = [...new Set(question.options.map((option) => option.trim()))];
    return {
      id: `model-${index + 1}`,
      label: question.label.trim(),
      reason: question.reason.trim(),
      options,
      recommended: options.includes(question.recommended.trim())
        ? question.recommended.trim()
        : options[0],
    };
  });
}
