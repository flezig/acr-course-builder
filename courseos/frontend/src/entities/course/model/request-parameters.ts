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
export function parameterDiscrepancies(requirements: Requirements) {
  const explicit = explicitRequestParameters(requirements.request);
  return [
    explicit.hours &&
    requirements.total_hours &&
    Number(explicit.hours) !== Number(requirements.total_hours)
      ? `В запросе ${explicit.hours} ч, в сводке ${requirements.total_hours} ч.`
      : '',
    explicit.weeks &&
    requirements.calendar.calendar_days &&
    explicit.weeks * 7 !== requirements.calendar.calendar_days
      ? `В запросе ${explicit.weeks} нед., в сводке ${requirements.calendar.calendar_days / 7} нед.`
      : '',
  ].filter(Boolean);
}
