import Decimal from 'decimal.js';
import type { Requirements } from './schema';

// Это только поиск явных чисел для сверки, а не анализ свободного запроса моделью.
export function explicitRequestParameters(request: string) {
  // Длительность занятия («по 3 часа») и нагрузка («4 часа в день») — не объём курса.
  // Если в тексте несколько разных объёмов, сверять не с чем: расхождение не показываем.
  const totals = new Set(
    [
      ...request.matchAll(
        /(?<!по\s)(\d+(?:[.,]\d+)?)\s*(?:академических\s+)?(?:часов|часа|час|ч)(?![а-яё])(?!\s*(?:в|за|\/)\s*(?:день|сутки|недел|занят))/gi,
      ),
    ].map((match) => match[1].replace(',', '.')),
  );
  const hours = totals.size === 1 ? [...totals][0] : undefined;
  const weeksText = request
    .match(/(\d+|одн[ау]|дв[ае]|три|четыре|пять|шесть|восемь)\s+недел/i)?.[1]
    ?.toLowerCase();
  const words: Record<string, number> = {
    одна: 1,
    одну: 1,
    два: 2,
    две: 2,
    три: 3,
    четыре: 4,
    пять: 5,
    шесть: 6,
    восемь: 8,
  };
  return { hours, weeks: weeksText ? (words[weeksText] ?? Number(weeksText)) : undefined };
}

// Допустимый объём программы по условиям кейса.
export const hoursRange = { min: 16, max: 500 };

export interface SummaryFix {
  label: string;
  total_hours?: string;
  calendar_days?: number;
}

export interface SummaryProblem {
  id: string;
  message: string;
  fix?: SummaryFix;
}

// Что мешает создать программу по сводке, и как это исправить одним действием.
// Расхождение с текстом важнее диапазона: сначала нужно понять, какой объём верный.
export function summaryProblems(requirements: Requirements): SummaryProblem[] {
  const problems: SummaryProblem[] = [];
  const explicit = explicitRequestParameters(requirements.request);
  const hours = requirements.total_hours.trim();
  const numeric = hours && !Number.isNaN(Number(hours)) ? new Decimal(hours) : null;
  if (explicit.hours && numeric && !numeric.eq(explicit.hours))
    problems.push({
      id: 'hours-text',
      message: `В тексте запроса ${explicit.hours} ч, а в сводке ${hours} ч.`,
      fix: { label: `Взять ${explicit.hours} ч из текста`, total_hours: explicit.hours },
    });
  else if (hours && !numeric)
    problems.push({
      id: 'hours-format',
      message: 'Объём в сводке нужно указать числом, например 72.',
    });
  else if (numeric && numeric.lt(hoursRange.min))
    problems.push({
      id: 'hours-min',
      message: `Объём ${hours} ч меньше минимума: программа АЦР — от ${hoursRange.min} до ${hoursRange.max} ч. Увеличьте число занятий, их длительность или срок либо задайте объём вручную.`,
      fix: { label: `Сделать ${hoursRange.min} ч`, total_hours: String(hoursRange.min) },
    });
  else if (numeric && numeric.gt(hoursRange.max))
    problems.push({
      id: 'hours-max',
      message: `Объём ${hours} ч больше максимума: программа АЦР — от ${hoursRange.min} до ${hoursRange.max} ч.`,
      fix: { label: `Сделать ${hoursRange.max} ч`, total_hours: String(hoursRange.max) },
    });
  else if (numeric && !numeric.mod('0.5').eq(0))
    problems.push({
      id: 'hours-step',
      message: `Объём ${hours} ч не кратен получасу.`,
      fix: {
        label: `Округлить до ${numeric.toNearest('0.5').toString()} ч`,
        total_hours: numeric.toNearest('0.5').toString(),
      },
    });
  const days = requirements.calendar.calendar_days;
  if (explicit.weeks && days && explicit.weeks * 7 !== days)
    problems.push({
      id: 'weeks-text',
      message: `В тексте запроса ${explicit.weeks} нед., а в сводке ${Math.round((days / 7) * 10) / 10} нед.`,
      fix: { label: `Взять ${explicit.weeks} нед. из текста`, calendar_days: explicit.weeks * 7 },
    });
  return problems;
}
