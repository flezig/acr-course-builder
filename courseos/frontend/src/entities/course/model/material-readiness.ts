import type { Material, Snapshot } from './schema';

export function questionProblems(material: Material, outcomeIds: Set<string>) {
  return material.questions.filter(
    (q) =>
      !q.text.trim() ||
      q.options.length < 2 ||
      q.options.some((o) => !o.trim()) ||
      new Set(q.options.map((o) => o.trim().toLowerCase())).size !== q.options.length ||
      !Number.isInteger(q.correct_index) ||
      q.correct_index < 0 ||
      q.correct_index >= q.options.length ||
      !q.explanation.trim() ||
      !q.outcome_ids.length ||
      q.outcome_ids.some((id) => !outcomeIds.has(id)),
  );
}
export function assessmentMaterial(
  snapshot: Snapshot,
  assessment: Snapshot['skeleton']['assessments'][number],
) {
  return snapshot.materials.find(
    (material) =>
      material.type === (assessment.type === 'practical' ? 'seminar' : assessment.type) &&
      (material.topic_id === assessment.topic_id || material.id === 'test-final') &&
      assessment.outcome_ids.every((id) => material.outcome_ids.includes(id)) &&
      (assessment.type !== 'test' ||
        assessment.outcome_ids.every((id) =>
          material.questions.some((q) => q.outcome_ids.includes(id)),
        )),
  );
}
export function materialReadiness(snapshot: Snapshot) {
  const outcomeIds = new Set(snapshot.skeleton.outcomes.map((o) => o.id));
  const incomplete = snapshot.materials.filter(
    (m) =>
      m.stale ||
      !m.content.trim() ||
      !m.expected.trim() ||
      !m.criteria.length ||
      m.criteria.some((criterion) => !criterion.trim()) ||
      (m.type === 'lecture' &&
        (!m.slides.length ||
          m.slides.some(
            (s) =>
              !s.title.trim() ||
              !s.bullets.length ||
              s.bullets.some((b) => !b.trim()) ||
              !s.notes.trim(),
          ))) ||
      (m.type === 'test' &&
        (!m.questions.length ||
          questionProblems(m, outcomeIds).length > 0 ||
          !m.test_policy ||
          m.test_policy.pass_count > m.questions.length)),
  );
  const missingAssessments = snapshot.skeleton.assessments.filter(
    (a) => !assessmentMaterial(snapshot, a),
  );
  return {
    incomplete,
    missingAssessments,
    complete: snapshot.materials.length > 0 && !incomplete.length && !missingAssessments.length,
  };
}
