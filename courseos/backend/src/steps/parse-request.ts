import { z } from 'zod';
import type { CallUsage, LlmGateway } from '../llm/gateway.ts';
import { LlmError } from '../llm/gateway.ts';

const instructions = `Ты помогаешь методисту Академии цифрового развития заполнить сводку параметров образовательной программы.
Извлеки параметры из запроса методиста и верни только JSON без пояснений и без Markdown.

Поля:
- title: короткое название программы (до 80 символов) по смыслу запроса;
- template_id: "acr_professional" для дополнительной профессиональной программы повышения квалификации (ДПП ПК, слушатели — специалисты или сотрудники организаций), "acr_general" для дополнительной общеразвивающей программы (школьники, интенсивы для широкой аудитории), "unknown", если из запроса нельзя понять;
- audience: кто слушатели;
- entry_level: входной уровень подготовки слушателей;
- goal: чему программа должна научить, одной фразой;
- total_hours: общий объём в академических часах числом в строке, например "72";
- delivery: форма обучения, только если она прямо названа в запросе (очная, заочная, очно-заочная, дистанционная и т. п.);
- assessment: форма итоговой аттестации;
- constraints: прочие ограничения и пожелания из запроса одной строкой;
- weeks: срок обучения в неделях числом или null;
- daily_limit: максимум часов в день числом в строке, например "4";
- missing: список коротких вопросов о сведениях, которых не хватает для каркаса программы (аудитория, входной уровень, объём, форма обучения, аттестация).

Не придумывай значения. Если сведений в запросе нет, верни пустую строку (для weeks — null) и добавь вопрос в missing.`;

export const parsedRequestSchema = z.object({
  title: z.string(),
  template_id: z.enum(['acr_general', 'acr_professional', 'unknown']),
  audience: z.string(),
  entry_level: z.string(),
  goal: z.string(),
  total_hours: z.string(),
  delivery: z.string(),
  assessment: z.string(),
  constraints: z.string(),
  weeks: z.number().positive().nullable(),
  daily_limit: z.string(),
  missing: z.array(z.string()),
});

export type ParsedRequest = z.infer<typeof parsedRequestSchema>;

export interface ParseRequestResult {
  parameters: ParsedRequest;
  // Расхождения, которые код нашёл между ответом модели и явными числами в тексте.
  corrections: string[];
  usage: CallUsage;
}

export async function parseRequest(gateway: LlmGateway, request: string) {
  const { content, usage } = await gateway.chat('parse_request', [
    { role: 'system', content: instructions },
    { role: 'user', content: request },
  ]);
  const parsed = parsedRequestSchema.safeParse(normalize(extractJson(content)));
  if (!parsed.success)
    throw new LlmError('empty', 'Модель вернула параметры не по схеме. Заполните сводку вручную.');
  return { ...checkAgainstText(parsed.data, request), usage } satisfies ParseRequestResult;
}

// GigaChat-3-Pro нередко оборачивает JSON в пояснение и блок ```json.
export function extractJson(content: string): unknown {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Модель может вернуть часы числом, а не строкой; в сводке часы хранятся строкой без единиц.
export function normalize(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const record = { ...(value as Record<string, unknown>) };
  // Отсутствующее значение модель передаёт как null или вовсе пропускает поле
  // (чаще всего пустой missing); это то же самое, что пустая строка или список.
  for (const [key, field] of Object.entries(parsedRequestSchema.shape))
    if (record[key] == null)
      record[key] = key === 'weeks' ? null : field instanceof z.ZodArray ? [] : '';
  for (const key of ['total_hours', 'daily_limit'])
    if (typeof record[key] === 'number') record[key] = String(record[key]);
  for (const key of ['total_hours', 'daily_limit'])
    if (typeof record[key] === 'string')
      record[key] = (record[key] as string).replace(',', '.').replace(/[^\d.]/g, '');
  // Вместо пустой строки модель иногда пишет «неизвестно» или «unknown»; в сводке это должно
  // остаться пустым полем. У template_id «unknown» — допустимое значение схемы.
  for (const [key, field] of Object.entries(record))
    if (
      key !== 'template_id' &&
      typeof field === 'string' &&
      /^(неизвестно|не указан[оа]?|нет данных|unknown|n\/a|none|null|—|-)$/i.test(field.trim())
    )
      record[key] = '';
  if (record.weeks === 0 || record.weeks === '') record.weeks = null;
  if (typeof record.weeks === 'string') record.weeks = Number(record.weeks) || null;
  return record;
}

// Числа, явно написанные методистом, важнее ответа модели: их проверяет код.
export function checkAgainstText(parameters: ParsedRequest, request: string) {
  const corrections: string[] = [];
  const result = { ...parameters };
  // Нагрузку «4 часа в день» и длительность занятия «по 2 часа» не путаем с общим объёмом;
  // при нескольких разных объёмах не правим.
  const totals = new Set(
    [
      ...request.matchAll(
        /(?<!по\s)(\d+(?:[.,]\d+)?)\s*(?:академических\s+)?(?:часов|часа|час|ч)(?![а-яё])(?!\s*(?:в|за|\/)\s*(?:день|сутки|недел))/gi,
      ),
    ].map((match) => match[1].replace(',', '.')),
  );
  if (totals.size === 1) {
    const [explicit] = totals;
    if (result.total_hours && Number(result.total_hours) !== Number(explicit))
      corrections.push(
        `Модель указала ${result.total_hours} ч, в тексте — ${explicit} ч; взято из текста.`,
      );
    result.total_hours = explicit;
  } else if (totals.size === 0) {
    // Объём задан расписанием («3 раза в неделю по 3 часа» за 2 недели): умножает код,
    // потому что модель в таком подсчёте ошибается.
    const schedule = request.match(
      /(\d+)\s*раз[а]?\s*в\s*неделю\s*по\s*(\d+(?:[.,]\d+)?)\s*(?:часов|часа|час|ч)(?![а-яё])/i,
    );
    const textWeeks = request.match(/(\d+)\s*недел/i)?.[1];
    const weeks = textWeeks ? Number(textWeeks) : result.weeks;
    if (schedule && weeks) {
      const computed = String(Number(schedule[1]) * Number(schedule[2].replace(',', '.')) * weeks);
      if (result.total_hours && Number(result.total_hours) !== Number(computed))
        corrections.push(
          `Модель указала ${result.total_hours} ч, по расписанию из запроса — ${schedule[1]} × ${schedule[2]} ч × ${weeks} нед. = ${computed} ч; взят расчёт.`,
        );
      result.total_hours = computed;
    }
  }
  // Форму обучения модель часто подставляет «по умолчанию» (очная), даже если её нет в тексте.
  // Сравниваем по корню из трёх букв: «очная» в ответе и «очно» в тексте — одна форма.
  const deliveryStem = result.delivery.trim().toLowerCase().slice(0, 3);
  if (deliveryStem && !request.toLowerCase().includes(deliveryStem)) {
    corrections.push(
      `Модель предложила форму обучения «${result.delivery}», но в запросе её нет; поле оставлено пустым.`,
    );
    result.delivery = '';
    result.missing = [...result.missing, 'форма обучения'];
  }
  // Стажировку движок узнаёт по форме обучения (все часы — самостоятельная работа),
  // а модель часто описывает её словами «работа с наставником» без самого слова.
  if (/стажировк/i.test(request) && !/стажиров/i.test(result.delivery)) {
    const delivery = `Стажировка${result.delivery ? `: ${result.delivery}` : ''}`;
    corrections.push(`Форма обучения дополнена: «${delivery}» — в запросе указана стажировка.`);
    result.delivery = delivery;
    result.missing = result.missing.filter((item) => !/форм/i.test(item));
  }
  return { parameters: result, corrections };
}
