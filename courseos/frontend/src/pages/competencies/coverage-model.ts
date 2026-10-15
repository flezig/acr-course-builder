import { outcomeAssessmentCount } from '../../entities/course/model/findings';
import type { Skeleton } from '../../entities/course/model/schema';
import { outcomeReviewStatus } from './outcome-review-model';

export function buildCoverage(skeleton: Skeleton) {
  return skeleton.outcomes.map((outcome) => {
    // Итоговая аттестация подтверждает результат, но не заменяет обучение.
    const topics = skeleton.topics.filter(
      (topic) => topic.id !== 'topic-final' && topic.outcome_ids.includes(outcome.id),
    );
    const activities = skeleton.activities.filter((activity) =>
      activity.outcome_ids.includes(outcome.id),
    );
    const assessments = skeleton.assessments.filter((assessment) =>
      assessment.outcome_ids.includes(outcome.id),
    );
    const missingAssessments = outcomeAssessmentCount(skeleton, outcome.id) < 2;
    const criteria = [
      ...new Set(
        [...(outcome.criteria || []), ...assessments.map((assessment) => assessment.criterion)]
          .map((criterion) => criterion.trim())
          .filter(Boolean),
      ),
    ];
    // Критерий результата не заменяет критерии выполнения каждого задания.
    const missingCriteria =
      !criteria.length || assessments.some((assessment) => !assessment.criterion.trim());
    const gaps = [
      !topics.length && 'Нет связанных тем',
      !assessments.length
        ? 'Нет проверочного задания'
        : missingAssessments && 'Нужно второе оценочное средство',
      missingCriteria && 'Не указаны критерии',
      assessments.some((assessment) => !assessment.action.trim()) &&
        'Не указана формулировка задания',
      assessments.some(
        (assessment) =>
          !skeleton.topics.some(
            (topic) => topic.id === assessment.topic_id && topic.outcome_ids.includes(outcome.id),
          ),
      ) && 'Тема задания не связана с результатом или отсутствует',
      assessments.some((assessment) => assessment.outcome_ids.length > 1) &&
        'Общее задание: нет детализации по результату',
    ].filter((gap): gap is string => !!gap);
    return {
      outcome,
      topics,
      activities,
      assessments,
      criteria,
      missingCriteria,
      missingAssessments,
      gaps,
      reviewed: outcomeReviewStatus(skeleton, outcome.id) === 'Проверен',
    };
  });
}
