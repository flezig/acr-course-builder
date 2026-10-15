import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { inputSchema, decimalSchema, changeInputSchema } from '../src/entities/course/model/schema';
import { presets } from '../src/entities/course/model/presets';
import { errorMessage } from '../src/shared/lib/error-message';

describe('Form validation boundaries', () => {
  it.each(['текст', '-1', '1.2.3', 'NaN', 'Infinity'])(
    'rejects invalid decimals without throwing: %s',
    (value) => {
      expect(decimalSchema.safeParse(value).success).toBe(false);
      const result = inputSchema.safeParse({ ...presets[0].requirements, total_hours: value });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].message).toMatch(/[а-я]/i);
    },
  );
  it('keeps optional hours empty, normalizes commas and enforces the course range', () => {
    for (const [value, expected] of [
      ['', ''],
      [' 16,5 ', '16.5'],
      ['500', '500'],
    ]) {
      const parsed = inputSchema.parse({ ...presets[0].requirements, total_hours: value });
      expect(parsed.total_hours).toBe(expected);
    }
    for (const value of ['0', '15.9', '500.1'])
      expect(
        inputSchema.safeParse({ ...presets[0].requirements, total_hours: value }).success,
      ).toBe(false);
  });
  it('validates hour changes before preview while allowing plain text for other changes', () => {
    const input = {
      type: 'hours',
      target_id: 'project-final',
      request: 'Изменить часы',
      replacement: 'не число',
    };
    const result = changeInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['replacement']);
    expect(changeInputSchema.safeParse({ ...input, replacement: '72,5' }).success).toBe(true);
    expect(changeInputSchema.safeParse({ ...input, type: 'audience' }).success).toBe(true);
  });
  it('replaces Zod internals and serialized union branches with localized messages', () => {
    const result = z
      .object({ total_hours: decimalSchema.or(z.literal('')) })
      .safeParse({ total_hours: 'вава' });
    if (result.success) throw new Error('Expected invalid hours');
    for (const error of [result.error, new Error(result.error.message)]) {
      expect(errorMessage(error)).toContain('Введите неотрицательное число');
      expect(errorMessage(error)).not.toMatch(/invalid_union|pattern|Invalid input|"path"/);
    }
    expect(errorMessage(new Error('[DecimalError] Invalid argument: вава'))).toBe(
      'Проверьте введённые значения в полях формы.',
    );
    expect(errorMessage(new Error('Нет доступа к этому курсу.'))).toBe(
      'Нет доступа к этому курсу.',
    );
  });
});
