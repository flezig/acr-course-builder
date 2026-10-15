import { describe, expect, it } from 'vitest';
import { skeletonSchema } from '../src/entities/course/model/schema';
import { makeSkeleton } from '../src/entities/course/model/factory';
import { presets } from '../src/entities/course/model/presets';
import {
  outcomeCriteria,
  outcomeReviewSignature,
  outcomeReviewStatus,
} from '../src/pages/competencies/outcome-review-model';
const skeleton = () => makeSkeleton(presets.find((p) => p.id === 'python')!.requirements);

describe('Проверка результатов относится к сохранённому содержанию и связям', () => {
  it('Наличие связей не подтверждает проверку пользователем', () => {
    const s = skeleton();
    const id = s.outcomes[0].id;
    expect(outcomeReviewStatus(s, id)).toBe('Нужна проверка');
    s.outcomes[0].review = {
      signature: outcomeReviewSignature(s, id),
      checked_at: '2026-10-15T12:00:00Z',
    };
    expect(outcomeReviewStatus(skeletonSchema.parse(s), id)).toBe('Проверен');
    s.outcomes[0].description += ' Самостоятельно.';
    expect(outcomeReviewStatus(s, id)).toBe('Нужна проверка');
  });
  it('Изменения связей и критериев снимают проверку, отсутствие оценивания имеет отдельный статус', () => {
    const s = skeleton();
    const id = s.outcomes[0].id;
    s.outcomes[0].review = {
      signature: outcomeReviewSignature(s, id),
      checked_at: '2026-10-15T12:00:00Z',
    };
    s.assessments.find((a) => a.outcome_ids.includes(id))!.criterion += ' Новый критерий.';
    expect(outcomeReviewStatus(s, id)).toBe('Нужна проверка');
    s.assessments.forEach((a) => {
      a.outcome_ids = a.outcome_ids.filter((o) => o !== id);
    });
    expect(outcomeReviewStatus(s, id)).toBe('Нет оценивания');
  });
  it('Критерии берутся из данных; пустой ручной список не подменяется сгенерированными критериями', () => {
    const s = skeleton();
    const id = s.outcomes[0].id;
    expect(outcomeCriteria(s, id)).toEqual([
      ...new Set(
        s.assessments
          .filter((a) => a.outcome_ids.includes(id))
          .map((a) => a.criterion)
          .filter(Boolean),
      ),
    ]);
    s.outcomes[0].criteria = [];
    expect(outcomeCriteria(s, id)).toEqual([]);
  });
});
