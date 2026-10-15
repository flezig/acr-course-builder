import type { Skeleton } from '../../entities/course/model/schema';
import { canonicalJson } from '../../shared/lib/decimal';

export const isPlaceholderOutcome = (text: string) =>
  /^Выполняет учебную задачу|^Демонстрирует действие:|^Объясняет решение по теме/.test(text);

export function outcomeCriteria(s: Skeleton, id: string) {
  const outcome = s.outcomes.find((o) => o.id === id);
  return (
    outcome?.criteria ?? [
      ...new Set(
        s.assessments
          .filter((a) => a.outcome_ids.includes(id))
          .map((a) => a.criterion)
          .filter(Boolean),
      ),
    ]
  );
}

// Проверка относится к содержанию и связям; изменение любого из них снимает статус.
export function outcomeReviewSignature(s: Skeleton, id: string) {
  const outcome = s.outcomes.find((o) => o.id === id);
  if (!outcome) return '';
  const { review: _review, ...content } = outcome;
  return canonicalJson({
    content,
    requirements: s.requirements,
    topics: s.topics.filter((t) => t.outcome_ids.includes(id)),
    activities: s.activities.filter((a) => a.outcome_ids.includes(id)),
    assessments: s.assessments.filter((a) => a.outcome_ids.includes(id)),
    rationales: s.rationales?.filter((r) => r.element_id === id || r.related_ids.includes(id)),
  });
}

export function outcomeReviewStatus(s: Skeleton, id: string) {
  if (!s.assessments.some((a) => a.outcome_ids.includes(id))) return 'Нет оценивания';
  const outcome = s.outcomes.find((o) => o.id === id);
  return outcome?.review?.signature === outcomeReviewSignature(s, id)
    ? 'Проверен'
    : 'Нужна проверка';
}
