import type { FieldErrors } from 'react-hook-form';

export type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export function isFormControl(target: unknown): target is FormControl {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
export function fieldError(errors: FieldErrors, name: string): string | undefined {
  const error = name
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      errors,
    );
  if (!error || typeof error !== 'object') return;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message ? message : 'Проверьте значение поля.';
}
export function controlError(control: FormControl): string | undefined {
  if (!control.willValidate) return;
  if (control.validity.badInput) return 'Введите число.';
  const value = control.value.trim();
  if (control.required && (!value || control.validity.valueMissing))
    return control instanceof HTMLSelectElement ? 'Выберите значение.' : 'Заполните это поле.';
  if (!value) return;
  if (control instanceof HTMLInputElement && control.type === 'url') {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
    } catch {
      return 'Введите полную ссылку, например https://example.com.';
    }
  }
  if (control.validity.typeMismatch) return 'Проверьте формат значения.';
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    if (control.minLength > 0 && value.length < control.minLength)
      return `Введите не менее ${control.minLength} символов.`;
    if (control.maxLength > 0 && value.length > control.maxLength)
      return `Введите не более ${control.maxLength} символов.`;
  }
  if (control instanceof HTMLInputElement) {
    if (control.validity.patternMismatch)
      return control.inputMode === 'decimal'
        ? 'Введите неотрицательное число, например 16 или 16,5.'
        : 'Проверьте формат значения.';
    if (control.validity.rangeUnderflow) return `Введите значение не меньше ${control.min}.`;
    if (control.validity.rangeOverflow) return `Введите значение не больше ${control.max}.`;
    if (control.validity.stepMismatch) return 'Введите целое число.';
  }
  if (control.validity.customError) return control.validationMessage;
}
export function focusInvalid(form: HTMLFormElement, control?: FormControl) {
  const target = control || form.querySelector<FormControl>('[aria-invalid="true"]');
  if (!target) return;
  let parent = target.parentElement;
  while (parent && parent !== form) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  target.focus();
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
}
