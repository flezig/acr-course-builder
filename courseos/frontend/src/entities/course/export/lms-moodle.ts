import type { Snapshot } from '../model/schema';
import { outcomeCodes } from './outcome-codes';

// Moodle XML выбран как формат LMS: его импортирует банк вопросов Moodle,
// а также большинство российских LMS на его основе. Каждый тест — своя категория,
// вопрос с одним верным ответом, тег с кодом результата обучения.
function escape(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const textTag = (text: string) => `<text>${escape(text)}</text>`;

export function lmsQuestionCount(snapshot: Snapshot) {
  return snapshot.materials
    .filter((m) => m.type === 'test')
    .reduce((count, m) => count + m.questions.length, 0);
}

export function buildMoodleXml(snapshot: Snapshot): string {
  const codes = outcomeCodes(snapshot.skeleton);
  const title = snapshot.skeleton.requirements.title;
  const tests = snapshot.materials.filter((m) => m.type === 'test' && m.questions.length);
  if (!tests.length) throw new Error('В этой версии нет тестов с вопросами — выгружать нечего.');
  const blocks = tests.flatMap((test) => [
    `  <question type="category">
    <category>${textTag(`$course$/top/${title}/${test.title}`)}</category>
    <info format="html">${textTag(
      test.test_policy
        ? `Тест сдан при ${test.test_policy.pass_count} верных ответах из ${test.questions.length}.`
        : '',
    )}</info>
  </question>`,
    ...test.questions.map((question, index) => {
      const answers = question.options
        .map(
          (
            option,
            optionIndex,
          ) => `    <answer fraction="${optionIndex === question.correct_index ? 100 : 0}" format="html">
      ${textTag(option)}
      <feedback format="html">${textTag(optionIndex === question.correct_index ? question.explanation : '')}</feedback>
    </answer>`,
        )
        .join('\n');
      const tags = question.outcome_ids
        .map((id) => `      <tag>${textTag(codes[id] ?? id)}</tag>`)
        .join('\n');
      return `  <question type="multichoice">
    <name>${textTag(`${String(index + 1).padStart(2, '0')}. ${question.text.slice(0, 80)}`)}</name>
    <questiontext format="html">${textTag(question.text)}</questiontext>
    <generalfeedback format="html">${textTag(question.explanation)}</generalfeedback>
    <defaultgrade>1</defaultgrade>
    <penalty>0</penalty>
    <hidden>0</hidden>
    <idnumber>${escape(`${snapshot.course_id}-${test.id}-${question.id}`)}</idnumber>
    <single>true</single>
    <shuffleanswers>true</shuffleanswers>
    <answernumbering>abc</answernumbering>
${answers}
    <tags>
${tags}
    </tags>
  </question>`;
    }),
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${escape(title)}, версия ${snapshot.course_version}. Черновик: ключи проверяет методист перед импортом. -->
<quiz>
${blocks.join('\n')}
</quiz>
`;
}
