import type { Snapshot } from '../model/schema';
import { plural } from '../../../shared/lib/plural';
import { outcomeCodes } from './outcome-codes';

// Moodle XML выбран как формат LMS: его импортирует банк вопросов Moodle,
// а также большинство российских LMS на его основе. Каждый тест — своя категория,
// вопрос с одним верным ответом, тег с кодом результата обучения.
function escapeXml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
// Поля с format="html" Moodle показывает как HTML, поэтому текст сначала
// экранируется для HTML (иначе «a < b» в коде съест браузер), затем для XML.
const html = (text: string) => escapeXml(escapeXml(text).replace(/\n/g, '<br>'));
const htmlText = (text: string) => `<text>${html(text)}</text>`;
const plainText = (text: string) => `<text>${escapeXml(text)}</text>`;

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
  const blocks = tests.flatMap((test, testIndex) => [
    `  <question type="category">
    <category>${plainText(`$course$/top/${title}/${test.title}`)}</category>
    <info format="html">${htmlText(
      test.test_policy
        ? `Тест сдан при ${test.test_policy.pass_count} верных ответах из ${test.questions.length}.`
        : `Вопросов: ${test.questions.length}.`,
    )}</info>
  </question>`,
    ...test.questions.map((question, index) => {
      const correct = question.options[question.correct_index];
      const answers = question.options
        .map((option, optionIndex) => {
          const right = optionIndex === question.correct_index;
          const feedback = right
            ? `Верно. ${question.explanation}`
            : `Неверно. Правильный ответ: «${correct}».`;
          return `    <answer fraction="${right ? 100 : 0}" format="html">
      ${htmlText(option)}
      <feedback format="html">${htmlText(feedback)}</feedback>
    </answer>`;
        })
        .join('\n');
      const tags = [...new Set(question.outcome_ids.map((id) => codes[id] ?? id))]
        .map((code) => `      <tag>${plainText(code)}</tag>`)
        .join('\n');
      const number = `${testIndex + 1}.${String(index + 1).padStart(2, '0')}`;
      return `  <question type="multichoice">
    <name>${plainText(`${number} ${question.text.replace(/\s+/g, ' ').slice(0, 80)}`)}</name>
    <questiontext format="html">${htmlText(question.text)}</questiontext>
    <generalfeedback format="html">${htmlText(question.explanation)}</generalfeedback>
    <defaultgrade>1</defaultgrade>
    <penalty>0</penalty>
    <hidden>0</hidden>
    <idnumber>${escapeXml(`${snapshot.course_id}-${test.id}-${question.id}`)}</idnumber>
    <single>true</single>
    <shuffleanswers>true</shuffleanswers>
    <answernumbering>abc</answernumbering>
    <showstandardinstruction>0</showstandardinstruction>
    <correctfeedback format="html">${htmlText('Ответ верный.')}</correctfeedback>
    <partiallycorrectfeedback format="html">${htmlText('Ответ частично верный.')}</partiallycorrectfeedback>
    <incorrectfeedback format="html">${htmlText('Ответ неверный.')}</incorrectfeedback>
${answers}
    <tags>
${tags}
    </tags>
  </question>`;
    }),
  ]);
  const questionCount = tests.reduce((count, test) => count + test.questions.length, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  ${escapeXml(title).replace(/-{2,}/g, '—')}, версия ${snapshot.course_version}: ${tests.length} ${plural(tests.length, ['тест', 'теста', 'тестов'])}, ${questionCount} ${plural(questionCount, ['вопрос', 'вопроса', 'вопросов'])}.
  Черновик: верные ответы и пояснения проверяет методист перед импортом.
  Импорт в Moodle: Курс → Банк вопросов → Импорт → формат «Moodle XML».
  Каждый тест попадает в свою категорию; теги «РО N» — коды результатов обучения из программы.
-->
<quiz>
${blocks.join('\n')}
</quiz>
`;
}
