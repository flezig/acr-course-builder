import { describe, expect, it } from 'vitest';
import { describeSkeletonField } from '../src/pages/comparison/version-diff';

describe('Сравнение каркаса', () => {
  it('показывает изменённое поле требований вместо всего JSON', () => {
    const before = {
      goal: 'Старая цель',
      audience: 'Аналитики',
      calendar: { start: '2026-10-14' },
    };
    const after = { goal: 'Новая цель', audience: 'Аналитики', calendar: { start: '2026-10-20' } };
    expect(describeSkeletonField(before, after)).toEqual([
      'Цель: Старая цель → Новая цель',
      'Календарь: Начало: 2026-10-14 → 2026-10-20',
    ]);
  });

  it('обрезает длинные значения', () => {
    const [line] = describeSkeletonField({ goal: 'а'.repeat(500) }, { goal: 'б' });
    expect(line.length).toBeLessThan(200);
  });
});
