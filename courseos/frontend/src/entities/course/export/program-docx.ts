import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { Material, Snapshot } from '../model/schema';
import { kindLabels } from '../model/presets';
import { formatHours, hourKinds, hourLabels } from '../../../shared/lib/decimal';
import {
  curriculumRows,
  formatDates,
  moduleHeading,
  programTypeName,
  replacedSectionField,
  sectionTable,
  topicHeading,
  unconfirmedSources,
} from './curriculum';
import { outcomeCodes } from './outcome-codes';
import { reviewItems } from './review-items';

// Агент не выпускает финальный документ: пустые поля остаются заметными
// прочерками, которые методист заполняет сам.
const blank = '____ (заполняет методист)';
const font = 'Times New Roman';
const muted = '666666';
const headerFill = 'E7ECF5';
const groupFill = 'F3F5F9';
const assessmentTypes: Material['type'][] = [
  'seminar',
  'project',
  'portfolio',
  'exam',
  'mentor_interview',
];

function lines(text: string) {
  return formatDates(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => new Paragraph({ text: line, spacing: { after: 80 } }));
}

function label(text: string) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text, bold: true })],
  });
}

type CellOptions = { bold?: boolean; fill?: string; align?: 'left' | 'center' };
function cell(text: string, options: CellOptions = {}) {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    shading: options.fill
      ? { type: ShadingType.CLEAR, color: 'auto', fill: options.fill }
      : undefined,
    children: [
      new Paragraph({
        alignment: options.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [new TextRun({ text: formatDates(text), bold: options.bold, size: 22 })],
      }),
    ],
  });
}

const border = { style: BorderStyle.SINGLE, size: 4, color: '9AA3B5' };
// widths — доли ширины страницы в процентах; числа в колонках с часами центрируются.
function table(
  header: string[],
  rows: { cells: string[]; bold?: boolean; fill?: string }[],
  widths: number[],
  centered: number[] = [],
) {
  const align = (index: number) => (centered.includes(index) ? 'center' : 'left');
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths.map((w) => Math.round(w * 93.5)),
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map((title, i) =>
          cell(title, { bold: true, fill: headerFill, align: align(i) }),
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            cantSplit: true,
            children: row.cells.map((value, i) =>
              cell(value, { bold: row.bold, fill: row.fill, align: align(i) }),
            ),
          }),
      ),
    ],
  });
}

// Колонки повторяют учебный план образцов АЦР: все виды работы показываются
// даже при нулевых часах, чтобы арифметику строки можно было сверить.
function curriculumTable(snapshot: Snapshot) {
  const rows = curriculumRows(snapshot.skeleton).map((row) => ({
    cells: [
      row.level === 'module'
        ? moduleHeading(row)
        : row.level === 'topic'
          ? topicHeading(row)
          : row.title,
      formatHours(row.total),
      ...hourKinds.map((kind) => formatHours(row.hours[kind])),
      row.control,
    ],
    bold: row.level !== 'topic',
    fill: row.level === 'topic' ? undefined : groupFill,
  }));
  return table(
    ['Наименование разделов и тем', 'Всего, ч', 'ЛК', 'ПР', 'ЛБ', 'СРС', 'Атт.', 'Форма контроля'],
    rows,
    [34, 8, 7, 7, 7, 7, 7, 23],
    [1, 2, 3, 4, 5, 6],
  );
}

function outcomesTable(snapshot: Snapshot) {
  const codes = outcomeCodes(snapshot.skeleton);
  return table(
    ['Код', 'Тип', 'Результат обучения', 'Трудовая функция'],
    snapshot.skeleton.outcomes.map((o) => ({
      cells: [codes[o.id], kindLabels[o.kind], o.description, o.professional_standard_code ?? '—'],
    })),
    [10, 14, 56, 20],
    [0],
  );
}

function calendarTable(snapshot: Snapshot) {
  const { skeleton } = snapshot;
  return table(
    ['№', 'Дата', 'Тема', 'Виды работы'],
    (skeleton.sessions ?? []).map((session, index) => ({
      cells: [
        String(index + 1),
        session.date,
        skeleton.topics.find((t) => t.id === session.topic_id)?.title ?? '',
        hourKinds
          .filter((kind) => Number(session.hours[kind]) > 0)
          .map((kind) => `${hourLabels[kind]} ${formatHours(session.hours[kind])} ч`)
          .join(', '),
      ],
    })),
    [7, 15, 43, 35],
    [0, 1],
  );
}

function workingPrograms(snapshot: Snapshot) {
  return snapshot.materials
    .filter((m) => m.type === 'working_program')
    .flatMap((m) => [
      new Paragraph({ text: m.title, heading: HeadingLevel.HEADING_3 }),
      ...m.content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          // Строки «Цель: …» выделяются как поля рабочей программы.
          const field = /^([^:.!?]{2,40}):\s+(.+)$/.exec(line);
          return new Paragraph({
            spacing: { after: 80 },
            children: field
              ? [new TextRun({ text: `${field[1]}: `, bold: true }), new TextRun(field[2])]
              : [new TextRun(line)],
          });
        }),
    ]);
}

const letter = (index: number) => String.fromCharCode(1072 + index);

function testBlock(material: Material, codes: Record<string, string>) {
  return [
    new Paragraph({ text: material.title, heading: HeadingLevel.HEADING_3 }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Вопросов: ${material.questions.length}.${material.test_policy ? ` Тест сдан при ${material.test_policy.pass_count} верных ответах.` : ''} Верный ответ выделен полужирным.`,
          italics: true,
        }),
      ],
    }),
    ...material.questions.flatMap((q, index) => [
      new Paragraph({
        keepNext: true,
        children: [new TextRun({ text: `${index + 1}. ${q.text}`, bold: true })],
        spacing: { before: 160, after: 40 },
      }),
      ...q.options.map(
        (option, optionIndex) =>
          new Paragraph({
            keepNext: true,
            indent: { left: 360 },
            children: [
              new TextRun({
                text: `${letter(optionIndex)}) ${option}`,
                bold: optionIndex === q.correct_index,
              }),
            ],
          }),
      ),
      new Paragraph({
        keepNext: true,
        indent: { left: 360 },
        children: [
          new TextRun({ text: 'Ключ: ', italics: true }),
          new TextRun(
            `${letter(q.correct_index)}) ${q.options[q.correct_index]}. ${q.explanation}`,
          ),
        ],
      }),
      new Paragraph({
        indent: { left: 360 },
        children: [
          new TextRun({
            text: `Проверяет: ${q.outcome_ids.map((id) => codes[id] ?? id).join(', ')}`,
            italics: true,
            color: muted,
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
    label('Критерии оценки'),
    ...material.criteria.map(
      (criterion) => new Paragraph({ text: criterion, bullet: { level: 0 } }),
    ),
  ];
}

function assessmentMaterials(snapshot: Snapshot) {
  const codes = outcomeCodes(snapshot.skeleton);
  const tests = snapshot.materials.filter((m) => m.type === 'test' && m.questions.length);
  const assignments = snapshot.materials.filter((m) => assessmentTypes.includes(m.type));
  return [...tests.flatMap((m) => testBlock(m, codes)), ...assignments.flatMap(assignmentBlock)];
}

function unconfirmedSourceList(snapshot: Snapshot) {
  const unconfirmed = unconfirmedSources(snapshot);
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

// Отдельная страница в конце: что методисту осталось заполнить или проверить.
// Страница не входит в программу и удаляется перед утверждением.
function reviewPage(snapshot: Snapshot) {
  const items = reviewItems(snapshot);
  return [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ text: 'Лист проверки методистом', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      spacing: { after: 160 },
      children: [
        new TextRun({
          text: 'Не входит в программу: удалите эту страницу после проверки.',
          italics: true,
          color: muted,
        }),
      ],
    }),
    ...(items.length
      ? items.map(
          (item) =>
            new Paragraph({
              spacing: { after: 100 },
              children: [
                new TextRun({ text: `☐ ${item.title}. `, bold: true }),
                new TextRun(item.detail),
              ],
            }),
        )
      : [new Paragraph('Открытых замечаний нет. Педагогическая экспертиза не проводилась.')]),
  ];
}

function sectionBody(snapshot: Snapshot, section: Snapshot['sections'][number]) {
  const kind = sectionTable(section.title);
  if (kind === 'curriculum') return [curriculumTable(snapshot)];
  if (kind === 'outcomes') return [outcomesTable(snapshot)];
  if (kind === 'working_programs') return workingPrograms(snapshot);
  // Расписание и распределение часов в разделах хранятся строками с ключами
  // видов работы; в документе их заменяют таблицы с подписями шаблона.
  const replaced = kind === 'calendar' || kind === 'hours' ? replacedSectionField[kind] : '';
  const fields = (section.fields ?? [{ label: 'Содержание', value: section.content }]).filter(
    (field) => field.label !== replaced,
  );
  const body: (Paragraph | Table)[] = fields.flatMap((field) => [
    label(field.label),
    ...(field.value.trim() ? lines(field.value) : [new Paragraph(blank)]),
  ]);
  if (kind === 'calendar' && snapshot.skeleton.sessions?.length)
    body.push(label('Расписание занятий'), calendarTable(snapshot));
  if (kind === 'hours') body.push(curriculumTable(snapshot));
  if (/Оценочные материалы/.test(section.title)) body.push(...assessmentMaterials(snapshot));
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
  const right = (text: string, after = 0) =>
    new Paragraph({ alignment: AlignmentType.RIGHT, text, spacing: { after } });
  return [
    centered('Автономная некоммерческая организация', { bold: true }),
    centered('дополнительного профессионального образования', { bold: true }),
    centered(`«${blank}»`, { bold: true }),
    new Paragraph({ spacing: { after: 600 } }),
    // Шапка повторяет образцы АЦР: реквизиты приказа агент не заполняет.
    right('УТВЕРЖДЕНО'),
    right('Приказом № ____-ОБР от «___» __________ 20__ г.'),
    right('Руководитель ____________ / ____________', 1600),
    centered(programTypeName(r).toUpperCase(), { bold: true }),
    centered(`«${r.title}»`, { bold: true, size: 32 }),
    new Paragraph({ spacing: { after: 400 } }),
    centered(`Объём: ${formatHours(r.total_hours)} ч`),
    centered(`Форма обучения: ${r.delivery || blank}`),
    centered(`Категория слушателей: ${r.audience || blank}`),
    new Paragraph({ spacing: { after: 1600 } }),
    centered(`Черновик версии ${snapshot.course_version} — требует проверки методистом`, {
      size: 20,
    }),
    centered('20__ г.'),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

export async function buildProgramDocx(snapshot: Snapshot): Promise<Blob> {
  // Титульный лист собирается отдельно, поэтому одноимённый раздел шаблона не дублируется.
  const sections = snapshot.sections.filter((s) => s.title !== 'Титульный лист');
  const heading = (size: number) => ({
    run: { font, size, bold: true, color: '000000' },
    paragraph: { spacing: { before: 280, after: 140 } },
  });
  const document = new Document({
    creator: 'CourseOS',
    title: snapshot.skeleton.requirements.title,
    styles: {
      default: {
        document: { run: { font, size: 24 }, paragraph: { spacing: { line: 276 } } },
        heading1: heading(30),
        heading2: heading(28),
        heading3: heading(24),
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } },
          titlePage: true,
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `Черновик, версия ${snapshot.course_version} — требует проверки методистом`,
                    size: 18,
                    color: muted,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })],
              }),
            ],
          }),
        },
        children: [
          ...titlePage(snapshot),
          ...sections.flatMap((section) => [
            new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_2 }),
            ...sectionBody(snapshot, section),
          ]),
          ...unconfirmedSourceList(snapshot),
          ...reviewPage(snapshot),
        ],
      },
    ],
  });
  return Packer.toBlob(document);
}
