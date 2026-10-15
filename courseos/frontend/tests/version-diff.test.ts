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
      { path: 'Цель', removed: 'Старая цель', added: 'Новая цель' },
      { path: 'Календарь — Начало', removed: '2026-10-14', added: '2026-10-20' },
    ]);
  });

  it('обрезает длинные элементы списков, но не текстовые поля', () => {
    const [source] = describeSkeletonField([], ['а'.repeat(500)]);
    expect(source.added!.length).toBeLessThan(200);
    const [goal] = describeSkeletonField({ goal: 'а'.repeat(500) }, { goal: 'б' });
    expect(goal.removed).toHaveLength(500);
  });
});
