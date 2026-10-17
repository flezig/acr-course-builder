import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { Material, Snapshot, Topic } from '../model/schema';
import { kindLabels } from '../model/presets';
import { hourTotals } from '../model/rules';
import { isProfessionalStandardReference } from '../model/professional-standards';
import { formatHours, hourKinds, hourLabels, sumHours } from '../../../shared/lib/decimal';
import { outcomeCodes } from './outcome-codes';
import { isInternship } from '../model/hours-plan';

// Агент не выпускает финальный документ: пустые поля остаются заметными
// прочерками, которые методист заполняет сам.
const blank = '____ (заполняет методист)';

const templateNames = {
  acr_professional: 'Дополнительная профессиональная программа повышения квалификации',
  acr_general: 'Дополнительная общеобразовательная общеразвивающая программа',
  unknown: 'Образовательная программа',
};

function lines(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => new Paragraph({ text: line, spacing: { after: 80 } }));
}

function cell(text: string, bold = false) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });
}

function table(header: string[], rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((title) => cell(title, true)) }),
      ...rows.map((row, index) => {
        const total = index === rows.length - 1 && row[0] === 'Итого';
        return new TableRow({ children: row.map((value) => cell(value, total)) });
      }),
    ],
  });
}

// Колонки повторяют учебный план образцов АЦР: все виды работы показываются
// даже при нулевых часах, чтобы арифметику строки можно было сверить.
function curriculumTable(snapshot: Snapshot) {
  const { skeleton } = snapshot;
  const hoursRow = (title: string, topics: Topic[], control: string) => [
    title,
    formatHours(sumHours(topics.map((t) => t.planned_total))),
    ...(['lecture', 'practice', 'lab', 'self_study', 'assessment'] as const).map((kind) =>
      formatHours(sumHours(topics.map((t) => t.hours[kind]))),
    ),
    control,
  ];
  const modules = [...new Set(skeleton.topics.map((t) => t.module_id))];
  const moduleTitles = skeleton.requirements.model_design?.module_titles ?? [];
  // Нумерация как в образцах АЦР: «Модуль 1. Название», затем «Тема 1.1.».
  const rows = modules.flatMap((moduleId, index) => {
    const topics = skeleton.topics.filter((t) => t.module_id === moduleId);
    if (moduleId === 'module-final') return topics.map((t) => hoursRow(t.title, [t], t.control));
    const moduleTitle = moduleTitles[index];
    return [
      hoursRow(`Модуль ${index + 1}${moduleTitle ? `. ${moduleTitle}` : ''}`, topics, ''),
      ...topics.map((t, topicIndex) =>
        hoursRow(`Тема ${index + 1}.${topicIndex + 1}. ${t.title}`, [t], t.control),
      ),
    ];
  });
  const totals = hourTotals(skeleton);
  return table(
    ['Наименование разделов и тем', 'Всего, ч', 'ЛК', 'ПР', 'ЛБ', 'СРС', 'Аттестация', 'Контроль'],
    [
      ...rows,
      [
        'Итого',
        formatHours(sumHours(Object.values(totals))),
        ...Object.values(totals).map(formatHours),
        '',
      ],
    ],
  );
}

function outcomesTable(snapshot: Snapshot) {
  const codes = outcomeCodes(snapshot.skeleton);
  return table(
    ['Код', 'Тип', 'Результат обучения', 'Трудовая функция'],
    snapshot.skeleton.outcomes.map((o) => [
      codes[o.id],
      kindLabels[o.kind],
      o.description,
      o.professional_standard_code ?? '—',
    ]),
  );
}

function calendarTable(snapshot: Snapshot) {
  const { skeleton } = snapshot;
  return table(
    ['Дата', 'Тема', 'Виды работы'],
    (skeleton.sessions ?? []).map((session) => [
      session.date,
      skeleton.topics.find((t) => t.id === session.topic_id)?.title ?? '',
      hourKinds
        .filter((kind) => Number(session.hours[kind]) > 0)
        .map((kind) => `${hourLabels[kind]} ${formatHours(session.hours[kind])} ч`)
        .join(', '),
    ]),
  );
}

function workingPrograms(snapshot: Snapshot) {
  return snapshot.materials
    .filter((m) => m.type === 'working_program')
    .flatMap((m) => [
      new Paragraph({ text: m.title, heading: HeadingLevel.HEADING_3 }),
      ...lines(m.content),
    ]);
}

function testBlock(material: Material, codes: Record<string, string>) {
  return [
    new Paragraph({ text: material.title, heading: HeadingLevel.HEADING_3 }),
    ...(material.test_policy
      ? [new Paragraph(`Тест сдан при ${material.test_policy.pass_count} верных ответах.`)]
      : []),
    ...material.questions.flatMap((q, index) => [
      new Paragraph({
        children: [new TextRun({ text: `${index + 1}. ${q.text}`, bold: true })],
        spacing: { before: 120 },
      }),
      ...q.options.map(
        (option, optionIndex) =>
          new Paragraph({
            text: `${String.fromCharCode(1072 + optionIndex)}) ${option}`,
            indent: { left: 360 },
          }),
      ),
      new Paragraph({
        children: [
          new TextRun({ text: 'Ключ: ', italics: true }),
          new TextRun(
            `${String.fromCharCode(1072 + q.correct_index)}) ${q.options[q.correct_index]}. ${q.explanation}`,
          ),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Проверяет: ${q.outcome_ids.map((id) => codes[id] ?? id).join(', ')}`,
            italics: true,
            color: '666666',
          }),
        ],
      }),
    ]),
  ];
}

function assignmentBlock(material: Material) {
  return [
    new Paragraph({ text: material.title, heading: HeadingLevel.HEADING_3 }),
    ...lines(material.content),
    new Paragraph({
      children: [
        new TextRun({ text: 'Ожидаемый результат: ', bold: true }),
        new TextRun(material.expected),
      ],
    }),
    new Paragraph({ children: [new TextRun({ text: 'Критерии оценки', bold: true })] }),
    ...material.criteria.map(
      (criterion) => new Paragraph({ text: criterion, bullet: { level: 0 } }),
    ),
  ];
}

function assessmentMaterials(snapshot: Snapshot) {
  const codes = outcomeCodes(snapshot.skeleton);
  const tests = snapshot.materials.filter((m) => m.type === 'test' && m.questions.length);
  const assignments = snapshot.materials.filter((m) =>
    ['seminar', 'project', 'portfolio', 'exam', 'mentor_interview'].includes(m.type),
  );
  return [...tests.flatMap((m) => testBlock(m, codes)), ...assignments.flatMap(assignmentBlock)];
}

// Требование ТЗ: неподтверждённый источник нельзя выдавать за проверенный,
// поэтому такие источники выносятся в отдельный явно помеченный список.
function unconfirmedSources(snapshot: Snapshot) {
  const unconfirmed = snapshot.sources.filter(
    (s) =>
      !isProfessionalStandardReference(s) &&
      !(s.provenance?.content === 'confirmed' && s.provenance?.access === 'read'),
  );
  if (!unconfirmed.length) return [];
  return [
    new Paragraph({ text: 'Источники, требующие проверки', heading: HeadingLevel.HEADING_2 }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'Источники не подтверждены и не включены в списки литературы. Методист проверяет их перед утверждением.',
          italics: true,
        }),
      ],
    }),
    ...unconfirmed.map(
      (s) =>
        new Paragraph({
          text: `[НЕ ПОДТВЕРЖДЁН] ${s.name}${s.url ? `; ${s.url}` : ''}`,
          bullet: { level: 0 },
        }),
    ),
  ];
}

function sectionBody(snapshot: Snapshot, section: Snapshot['sections'][number]) {
  const title = section.title;
  if (/^2\.1 Учебный план/.test(title)) return [curriculumTable(snapshot)];
  if (/Результаты обучения|Знания, умения/.test(title)) return [outcomesTable(snapshot)];
  if (/Рабочие программы/.test(title)) return workingPrograms(snapshot);
  // Расписание и распределение часов в разделах хранятся строками с ключами
  // видов работы; в документе их заменяют таблицы с подписями шаблона.
  const tableField = /Календар/.test(title)
    ? 'Расписание'
    : /Объём/.test(title)
      ? 'Распределение'
      : '';
  const fields = (section.fields ?? [{ label: 'Содержание', value: section.content }]).filter(
    (field) => field.label !== tableField,
  );
  const body: (Paragraph | Table)[] = fields.flatMap((field) => [
    new Paragraph({
      children: [new TextRun({ text: field.label, bold: true })],
      spacing: { before: 120 },
    }),
    ...(field.value.trim() ? lines(field.value) : [new Paragraph(blank)]),
  ]);
  if (tableField === 'Расписание' && snapshot.skeleton.sessions?.length)
    body.push(calendarTable(snapshot));
  if (tableField === 'Распределение') body.push(curriculumTable(snapshot));
  if (/Оценочные материалы/.test(title)) body.push(...assessmentMaterials(snapshot));
  return body;
}

function titlePage(snapshot: Snapshot) {
  const r = snapshot.skeleton.requirements;
  const centered = (text: string, options: { bold?: boolean; size?: number } = {}) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text, ...options })],
    });
  return [
    centered('Автономная некоммерческая организация', { bold: true }),
    centered('дополнительного профессионального образования', { bold: true }),
    centered(`«${blank}»`, { bold: true }),
    // Шапка повторяет образцы АЦР: реквизиты приказа агент не заполняет.
    new Paragraph({ alignment: AlignmentType.RIGHT, text: 'УТВЕРЖДЕНО' }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      text: 'Приказом № ____-ОБР от «___» __________ 20__ г.',
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      text: 'Руководитель ____________ / ____________',
      spacing: { after: 1200 },
    }),
    centered(
      `${templateNames[r.template_id]}${isInternship(r) ? ' в форме стажировки' : ''}`.toUpperCase(),
      { bold: true },
    ),
    centered(`«${r.title}»`, { bold: true, size: 32 }),
    centered(`Объём: ${formatHours(r.total_hours)} ч · Форма обучения: ${r.delivery || blank}`),
    centered(`Черновик версии ${snapshot.course_version} — требует проверки методистом`, {
      size: 20,
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

export async function buildProgramDocx(snapshot: Snapshot): Promise<Blob> {
  // Титульный лист собирается отдельно, поэтому одноимённый раздел шаблона не дублируется.
  const sections = snapshot.sections.filter((s) => s.title !== 'Титульный лист');
  const document = new Document({
    creator: 'CourseOS',
    title: snapshot.skeleton.requirements.title,
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } },
        children: [
          ...titlePage(snapshot),
          ...sections.flatMap((section) => [
            new Paragraph({
              text: section.title,
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 120 },
            }),
            ...sectionBody(snapshot, section),
          ]),
          ...unconfirmedSources(snapshot),
        ],
      },
    ],
  });
  return Packer.toBlob(document);
}
