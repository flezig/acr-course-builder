import { z } from 'zod';

const fallback = 'Не удалось выполнить действие. Попробуйте ещё раз.';
const validationFallback = 'Проверьте введённые значения в полях формы.';
const fieldLabels: Record<string, string> = {
  total_hours: 'Объём часов',
  daily_limit: 'Максимум часов в день',
  calendar_days: 'Календарных дней',
  title: 'Название',
  audience: 'Аудитория',
  replacement: 'Новый текст',
  request: 'Запрос',
};
function validationMessage(issues: unknown[]): string {
  const messages = issues.flatMap((issue): string[] => {
    if (!issue || typeof issue !== 'object') return [];
    const value = issue as { message?: unknown; path?: unknown; errors?: unknown[][] };
    // Union branches contain implementation details; use a concrete localized message.
    if (value.errors && Array.isArray(value.errors)) {
      const nested = validationMessage(value.errors.flat());
      return nested === validationFallback ? [] : [nested];
    }
    if (typeof value.message !== 'string' || !/[а-яё]/i.test(value.message)) return [];
    const path = Array.isArray(value.path) ? value.path : [];
    const label = fieldLabels[String(path[path.length - 1])];
    return [label ? `${label}: ${value.message}` : value.message];
  });
  return [...new Set(messages)].join('. ') || validationFallback;
}
export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return validationMessage(error.issues);
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (/^[\[{]/.test(message)) {
    try {
      const parsed: unknown = JSON.parse(message);
      return Array.isArray(parsed) ? validationMessage(parsed) : validationFallback;
    } catch {
      return validationFallback;
    }
  }
  if (/invalid_union|invalid input|ZodError|\[DecimalError\]/i.test(message))
    return validationFallback;
  return message || fallback;
}
