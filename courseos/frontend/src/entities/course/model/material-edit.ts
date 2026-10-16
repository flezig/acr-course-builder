import { ApiError } from '../../../shared/api/http';
import { canonicalJson } from '../../../shared/lib/decimal';
import type { ChangeInput, Snapshot } from './schema';
import { questionProblems } from './material-readiness';

export function isElementEdit(input: ChangeInput) {
  return ['question', 'slide', 'assignment', 'material'].includes(input.type);
}
export function previewElementEdit(snapshot: Snapshot, input: ChangeInput) {
  const original = snapshot.materials.find((m) =>
    input.type === 'question'
      ? m.questions.some((q) => q.id === input.target_id)
      : input.type === 'slide'
        ? m.slides.some((s) => s.id === input.target_id)
        : m.id === input.target_id,
  );
  if (!original || original.stale)
    throw new ApiError(422, 'Выберите существующий актуальный элемент.');
  const material = structuredClone(original);
  let before: unknown = original;
  let after: unknown;
  let requiresApproval = false;
  if (input.type === 'question') {
    const question = material.questions.find((q) => q.id === input.target_id)!;
    before = structuredClone(question);
    question.text = input.replacement;
    if (input.options) question.options = input.options;
    if (input.correct_index !== undefined) question.correct_index = input.correct_index;
    if (input.explanation !== undefined) question.explanation = input.explanation;
    if (input.outcome_ids) {
      requiresApproval = canonicalJson(question.outcome_ids) !== canonicalJson(input.outcome_ids);
      question.outcome_ids = input.outcome_ids;
      material.outcome_ids = [...new Set(material.questions.flatMap((q) => q.outcome_ids))];
    }
    if (questionProblems(material, new Set(snapshot.skeleton.outcomes.map((o) => o.id))).length)
      throw new ApiError(
        422,
        'Проверьте вопрос: текст, разные варианты, существующий ключ, объяснение и связи с результатами.',
      );
    after = question;
  } else if (input.type === 'slide') {
    const slide = material.slides.find((s) => s.id === input.target_id)!;
    before = structuredClone(slide);
    if (!input.slide) throw new ApiError(422, 'Укажите заголовок, содержание и заметки слайда.');
    Object.assign(slide, input.slide);
    after = slide;
  } else {
    before = {
      content: original.content,
      expected: original.expected,
      criteria: original.criteria,
    };
    material.content = input.replacement;
    if (input.expected !== undefined) material.expected = input.expected;
    if (input.criteria) material.criteria = input.criteria;
    requiresApproval =
      input.type === 'assignment' ||
      material.expected !== original.expected ||
      canonicalJson(material.criteria) !== canonicalJson(original.criteria);
    after = { content: material.content, expected: material.expected, criteria: material.criteria };
  }
  if (input.manual) material.manual = true;
  return { material, requiresApproval, before: canonicalJson(before), after: canonicalJson(after) };
}
