import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { Material, Requirements, Snapshot } from '../model/schema';
import { kindLabels } from '../model/presets';
import { isInternship } from '../model/hours-plan';
import { formatHours, hourKinds, hourLabels } from '../../../shared/lib/decimal';
import {
  curriculumRows,
  formatDates,
  programTypeName,
  replacedSectionField,
  sectionTable,
  unconfirmedSources,
} from './curriculum';
import { outcomeCodes } from './outcome-codes';
import { reviewItems } from './review-items';

// Агент не выпускает финальный документ: пустые поля остаются заметными
// прочерками, которые методист заполняет сам.
const blank = '____ (заполняет методист)';
const font = 'Times New Roman';
const muted = '666666';
const dashList = 'dash-list';

// Оформление снято с образцов АЦР («Пример ДПП — Бизнес и системный анализ»
// и «Пример ДООП — Интенсив по ИИ-продуктам»): у ДПП 12 пт, одинарный
// интервал и отбивка после абзаца, у ДООП 14 пт, полуторный интервал и
// красная строка 1,25 см. Колонтитулов и номеров страниц в образцах нет.
const layouts = {
  professional: {
    size: 24,
    margin: { top: 1135, right: 851, bottom: 1418, left: 1276 },
    body: { line: 240, after: 120, firstLine: 0 },
    chapter: { size: 26, before: 320, after: 160 },
    heading: { size: 24, before: 240, after: 120, firstLine: 0 },
    list: { left: 538, hanging: 357 },
    tableSize: 22,
    curriculumSize: 20,
    headerFill: 'E7E6E6',
  },
  general: {
    size: 28,
    margin: { top: 1134, right: 850, bottom: 1134, left: 1701 },
    body: { line: 360, after: 0, firstLine: 709 },
    chapter: { size: 28, before: 0, after: 0 },
    heading: { size: 28, before: 0, after: 0, firstLine: 709 },
    list: { left: 1069, hanging: 360 },
    tableSize: 24,
    curriculumSize: 20,
    headerFill: 'D9D9D9',
  },
};
type Layout = (typeof layouts)[keyof typeof layouts];
const layoutOf = (r: Requirements) =>
  r.template_id === 'acr_general' ? layouts.general : layouts.professional;

// Названия разделов и глав как в образцах; внутренние названия разделов
// короче, чтобы их было удобно показывать в интерфейсе.
const professionalTitles: Record<string, string> = {
  '1.1 Аннотация': 'Аннотация программы',
  '1.2 Цель реализации': 'Цель реализации программы',
  '1.3 Результаты обучения': 'Планируемые результаты обучения (РО)',
  '1.4 Основания разработки': 'Программа разработана на основе:',
  '1.5 Профессиональные компетенции и трудовые функции':
    'Перечень профессиональных компетенций в рамках имеющейся квалификации, качественное изменение которых осуществляется в результате обучения:',
  '1.6 Требования к слушателям': 'Требования к слушателям (категории слушателей)',
  '1.8 Объём': 'Объём программы',
  '2.3 Календарный график': 'Календарный учебный график',
  '2.4 Рабочие программы': 'Рабочая программа учебных дисциплин',
  '2.5.1 Формы текущей и итоговой аттестации':
    'Форма(ы) текущей, промежуточной и итоговой аттестации',
  '2.5.3 Анализ удовлетворённости': 'Анализ удовлетворённости требований слушателей',
  '3.1 Техническое обеспечение': 'Материально-техническое обеспечение',
  '3.3 Организация обучения': 'Организация образовательного процесса',
  '3.4 Кадровое обеспечение': 'Кадровое обеспечение образовательного процесса',
};
const generalTitles: Record<string, string> = {
  '1.1 Актуальность': 'Актуальность Программы',
  '1.3 Цель и задачи': 'Цель и задачи программы',
  '1.5 Знания, умения и навыки': 'Планируемые результаты обучения',
  '1.6 Календарный график': 'Календарный учебный график',
  '2.4 Методические рекомендации': 'Методические материалы',
  '3.1 Материально-технические условия': 'Материально-технические условия реализации программы',
  '3.2 Учебно-методическое обеспечение':
    'Учебно-методическое и информационное обеспечение программы',
  '3.4 Кадровое обеспечение': 'Кадровое обеспечение программы',
};
const professionalChapters: Record<string, string> = {
  '1': '1. ОБЩАЯ ХАРАКТЕРИСТИКА ДОПОЛНИТЕЛЬНОЙ ПРОФЕССИОНАЛЬНОЙ ПРОГРАММЫ',
  '2': '2. СОДЕРЖАНИЕ ПРОГРАММЫ',
  '2.5': '2.5. Оценка качества освоения программы',
  '3': '3. ОРГАНИЗАЦИОННО-ПЕДАГОГИЧЕСКИЕ УСЛОВИЯ РЕАЛИЗАЦИИ ПРОГРАММЫ',
  '3.2': '3.2. Учебно-методическое и информационное обеспечение',
};
const generalChapters: Record<string, string> = {
  '2': '2. Содержание программы',
  '3': '3. Организационно-педагогические условия реализации программы',
  '3.3': '3.3. Литература',
};

// Подпись приложения в образце ДООП: «к … программе «Название»».
const appendixOf = {
  acr_professional: 'к дополнительной профессиональной программе повышения квалификации',
  acr_general: 'к дополнительной общеобразовательной общеразвивающей программе',
  unknown: 'к образовательной программе',
};

const assessmentTypes: Material['type'][] = [
  'test',
  'seminar',
  'project',
  'portfolio',
  'exam',
  'mentor_interview',
];
// Итоговые материалы идут в приложение об итоговой аттестации, остальные —
// в приложение о текущем контроле, как разделены образцы ДПП.
const isFinal = (m: Material) =>
  ['project', 'exam', 'portfolio'].includes(m.type) ||
  m.module_id === 'module-final' ||
  /итогов/i.test(m.title);

export async function buildProgramDocx(snapshot: Snapshot): Promise<Blob> {
  const r = snapshot.skeleton.requirements;
  const layout = layoutOf(r);
  const general = layout === layouts.general;
  const codes = outcomeCodes(snapshot.skeleton);

  // Интервалы и красная строка задаются и в стилях, и прямо в абзацах:
  // Word берёт их из стилей, а Pages и просмотр macOS читают только абзац.
  const spacing = {
    line: layout.body.line,
    lineRule: LineRuleType.AUTO,
    after: layout.body.after,
    before: 0,
  };
  const heading = (text: string, level: 1 | 2 | 3) => {
    const sizes = { 1: layout.chapter, 2: layout.heading, 3: layout.heading };
    return new Paragraph({
      heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1],
      keepNext: true,
      indent: { firstLine: layout.heading.firstLine },
      spacing: {
        line: layout.body.line,
        lineRule: LineRuleType.AUTO,
        before: level === 3 && !general ? 120 : sizes[level].before,
        after: level === 3 && !general ? 60 : sizes[level].after,
      },
      children: [
        new TextRun({ text, bold: true, size: level === 3 ? layout.size : sizes[level].size }),
      ],
    });
  };
  const body = (children: TextRun[] | string, options: { keepNext?: boolean } = {}) =>
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing,
      indent: { firstLine: layout.body.firstLine },
      keepNext: options.keepNext,
      children: typeof children === 'string' ? [new TextRun(children)] : children,
    });
  // Пункты списков в образцах начинаются с тире и заканчиваются «;», последний — «.».
  const listItems = (items: string[]) =>
    items.map(
      (item, index) =>
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing,
          indent: layout.list,
          numbering: { reference: dashList, level: 0 },
          children: [
            new TextRun(
              /[?!]$/.test(item)
                ? item
                : `${item.replace(/[.;,]+$/, '')}${index === items.length - 1 ? '.' : ';'}`,
            ),
          ],
        }),
    );
  const textLines = (text: string) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  // Одна строка — обычный абзац, несколько — список с тире.
  // Тексты разделов отмечают пункты списка тире «– »; остальные строки — абзацы.
  // Многострочное значение без тире и без точек — перечень (литература, задачи), это список.
  const paragraphs = (text: string): Paragraph[] => {
    const lines = textLines(text);
    const csvStart = lines.findIndex((line) => /^[A-Za-z_]\w*(?:,[A-Za-z_]\w*){2,}$/.test(line));
    if (csvStart >= 0) {
      const columns = lines[csvStart].split(',').length;
      let csvEnd = csvStart + 1;
      while (
        csvEnd < lines.length &&
        /^\S+,/.test(lines[csvEnd]) &&
        lines[csvEnd].split(',').length === columns
      )
        csvEnd++;
      // CSV — исходные данные задания: даты, запятые и окончания строк
      // нельзя превращать в русские даты и пункты списка с точками с запятой.
      return [
        ...paragraphs(lines.slice(0, csvStart).join('\n')),
        ...lines.slice(csvStart, csvEnd).map(
          (line) =>
            new Paragraph({
              spacing: { after: 0, line: layout.body.line },
              children: [new TextRun({ text: line, font: 'Courier New', size: 20 })],
            }),
        ),
        ...paragraphs(lines.slice(csvEnd).join('\n')),
      ];
    }
    // Строки, которые все заканчиваются точкой или двоеточием, — абзацы связного текста.
    const prose = lines.every((line) => /[.:!?]$/.test(line));
    if (!lines.some((line) => line.startsWith('– ')))
      return lines.length > 1 && !prose
        ? listItems(lines)
        : lines.map((line) => body(sentence(line)));
    const result: Paragraph[] = [];
    let items: string[] = [];
    const flush = () => {
      result.push(...listItems(items));
      items = [];
    };
    for (const line of lines) {
      if (line.startsWith('– ')) items.push(line.slice(2));
      else {
        flush();
        result.push(body(sentence(line), { keepNext: line.endsWith(':') }));
      }
    }
    flush();
    return result;
  };
  const sentence = (text: string) => text.replace(/([^.?!:;»)])$/, '$1.');
  // После подписи поля значение продолжает предложение: «Аудитория: школьники…».
  // Аббревиатуры и имена с двумя заглавными подряд не трогаются.
  const continued = (text: string) =>
    /^[А-ЯЁ][а-яё]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
  const subheading = (text: string) =>
    new Paragraph({
      keepNext: true,
      spacing,
      indent: { firstLine: layout.body.firstLine },
      children: [new TextRun({ text, bold: true })],
    });

  type CellOptions = { bold?: boolean; fill?: string; center?: boolean; size: number };
  const cell = (text: string, options: CellOptions) =>
    new TableCell({
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 20, bottom: 20, left: 57, right: 57 },
      shading: options.fill
        ? { type: ShadingType.CLEAR, color: 'auto', fill: options.fill }
        : undefined,
      children: [
        new Paragraph({
          alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT,
          indent: { firstLine: 0 },
          spacing: { line: 240, after: 0, before: 0 },
          children: [
            new TextRun({ text: formatDates(text), bold: options.bold, size: options.size }),
          ],
        }),
      ],
    });
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'auto' };
  type Row = { cells: string[]; bold?: boolean; labelFill?: boolean };
  // widths — доли ширины текста в процентах; номера и часы центрируются.
  const table = (
    header: string[],
    rows: Row[],
    widths: number[],
    centered: number[] = [],
    size = layout.tableSize,
  ) => {
    const textWidth = 11906 - layout.margin.left - layout.margin.right;
    return new Table({
      width: { size: textWidth, type: WidthType.DXA },
      columnWidths: widths.map((w) => Math.round((w * textWidth) / 100)),
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
          children: header.map((title) =>
            cell(title, { bold: true, fill: layout.headerFill, center: true, size }),
          ),
        }),
        ...rows.map(
          (row) =>
            new TableRow({
              cantSplit: true,
              children: row.cells.map((value, i) =>
                cell(value, {
                  bold: row.bold,
                  fill: row.labelFill && i <= 1 ? layout.headerFill : undefined,
                  center: centered.includes(i),
                  size,
                }),
              ),
            }),
        ),
      ],
    });
  };

  // Колонки повторяют учебный план образцов АЦР: все виды работы показываются
  // даже при нулевых часах, чтобы арифметику строки можно было сверить.
  const curriculumTable = () =>
    table(
      [
        '№ п/п',
        'Наименование разделов (модулей) и тем',
        'Трудоёмкость, всего (час.)',
        'ЛК',
        'ПР',
        'ЛБ',
        'СРС (час.)',
        'ИА',
        'Форма контроля',
      ],
      curriculumRows(snapshot.skeleton).map((row) => ({
        cells: [
          row.number ? `${row.number}.` : '',
          row.level === 'module'
            ? `Модуль ${row.number}${row.title ? `. ${row.title}` : ''}`
            : row.title,
          formatHours(row.total),
          ...hourKinds.map((kind) => formatHours(row.hours[kind])),
          row.control,
        ],
        bold: row.level !== 'topic' || !row.number,
        labelFill: row.level === 'total' || (row.level === 'topic' && !row.number),
      })),
      [7, 31, 11, 6, 6, 6, 7, 6, 20],
      [0, 2, 3, 4, 5, 6, 7, 8],
      layout.curriculumSize,
    );

  // Как в образцах: темы с содержанием и формой контроля, модули — строками-разделами.
  const thematicTable = () =>
    table(
      ['№ п/п', 'Наименование разделов и тем', 'Всего (час.)', 'Содержание', 'Форма контроля'],
      curriculumRows(snapshot.skeleton)
        .filter((row) => row.level !== 'total')
        .map((row) => ({
          cells: [
            row.number ? `${row.number}.` : '',
            row.level === 'module'
              ? `Модуль ${row.number}${row.title ? `. ${row.title}` : ''}`
              : row.title,
            formatHours(row.total),
            row.topic?.content ?? '',
            row.control,
          ],
          bold: row.level === 'module' || !row.number,
          labelFill: row.level === 'topic' && !row.number,
        })),
      [8, 25, 10, 37, 20],
      [0, 2],
    );

  const outcomesBlock = () => {
    const outcomes = snapshot.skeleton.outcomes;
    // В образце ДООП результаты перечислены списками «Знания / Умения / Навыки»,
    // в образце ДПП — таблицей.
    if (general)
      return (['knowledge', 'skill', 'proficiency'] as const).flatMap((kind) => {
        const items = outcomes.filter((o) => o.kind === kind);
        if (!items.length) return [];
        return [
          subheading(`${kindLabels[kind]}:`),
          ...listItems(items.map((o) => `${o.description} (${codes[o.id]})`)),
        ];
      });
    return [
      table(
        ['Код', 'Тип', 'Результат обучения', 'Трудовая функция'],
        outcomes.map((o) => ({
          cells: [
            codes[o.id],
            kindLabels[o.kind],
            o.description,
            o.professional_standard_code ?? '—',
          ],
        })),
        [10, 14, 56, 20],
        [0, 3],
      ),
    ];
  };

  const calendarTable = () =>
    table(
      ['№ п/п', 'Дата', 'Тема', 'Виды работы'],
      (snapshot.skeleton.sessions ?? []).map((session, index) => ({
        cells: [
          `${index + 1}.`,
          session.date,
          snapshot.skeleton.topics.find((t) => t.id === session.topic_id)?.title ?? '',
          hourKinds
            .filter((kind) => Number(session.hours[kind]) > 0)
            .map((kind) => `${hourLabels[kind]} ${formatHours(session.hours[kind])} ч`)
            .join(', '),
        ],
      })),
      [8, 15, 45, 32],
      [0, 1],
    );

  const workingPrograms = () =>
    snapshot.materials
      .filter((m) => m.type === 'working_program')
      .flatMap((m) => [
        heading(m.title, 3),
        ...textLines(m.content).map((line) => {
          // Строки «Цель: …» выделяются как поля рабочей программы.
          const field = /^([^:.!?]{2,40}):\s+(.+)$/.exec(line);
          return body(
            field
              ? [
                  new TextRun({ text: `${field[1]}: `, bold: true }),
                  new TextRun(formatDates(continued(field[2]))),
                ]
              : line,
          );
        }),
      ]);

  const letter = (index: number) => String.fromCharCode(1072 + index);
  const option = (text: string, bold = false) =>
    new Paragraph({
      keepNext: true,
      indent: { left: 709, firstLine: 0 },
      spacing: { after: 0 },
      children: [new TextRun({ text, bold })],
    });
  const testBlock = (material: Material) => [
    heading(material.title, 3),
    body(
      `Вопросов: ${material.questions.length}.${material.test_policy ? ` Тест считается пройденным при ${material.test_policy.pass_count} верных ответах.` : ''} Верный ответ выделен полужирным шрифтом.`,
    ),
    ...material.questions.flatMap((q, index) => [
      body([new TextRun({ text: `${index + 1}. ${q.text}`, bold: true })], { keepNext: true }),
      ...q.options.map((text, i) => option(`${letter(i)}) ${text}`, i === q.correct_index)),
      new Paragraph({
        keepNext: true,
        indent: { left: 709, firstLine: 0 },
        spacing: { after: 0 },
        children: [
          new TextRun({ text: 'Ключ: ', italics: true }),
          new TextRun(
            `${letter(q.correct_index)}) ${q.options[q.correct_index]}. ${q.explanation}`,
          ),
        ],
      }),
      new Paragraph({
        indent: { left: 709, firstLine: 0 },
        children: [
          new TextRun({
            text: `Проверяет: ${q.outcome_ids.map((id) => codes[id] ?? id).join(', ')}`,
            italics: true,
          }),
        ],
      }),
    ]),
  ];
  const assignmentBlock = (material: Material) => [
    heading(material.title, 3),
    ...paragraphs(material.content),
    body([
      new TextRun({ text: 'Ожидаемый результат: ', bold: true }),
      new TextRun(material.expected),
    ]),
    subheading('Критерии оценки:'),
    ...listItems(material.criteria),
  ];
  const materialBlocks = (materials: Material[]) =>
    materials.flatMap((m) => (m.type === 'test' ? testBlock(m) : assignmentBlock(m)));
  // Тесты идут перед заданиями, как раньше в разделе оценочных материалов.
  const assessed = snapshot.materials
    .filter((m) => assessmentTypes.includes(m.type) && (m.type !== 'test' || m.questions.length))
    .sort((a, b) => Number(b.type === 'test') - Number(a.type === 'test'));

  const appendixHeader = (number: number, title: string) => [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      indent: { firstLine: 0 },
      children: [new TextRun({ text: `Приложение № ${number}`, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      indent: { firstLine: 0 },
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `${appendixOf[r.template_id]}${isInternship(r) ? ' в форме стажировки' : ''} «${r.title}»`,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
      spacing: { before: 240, after: 160 },
      children: [new TextRun({ text: title, bold: true })],
    }),
  ];

  // Номер раздела из названия: «2.5.1 Формы…» → «2.5.1».
  const numberOf = (title: string) => /^(\d+(?:\.\d+)*)\s/.exec(title)?.[1];
  const displayTitle = (title: string) => {
    const number = numberOf(title);
    if (!number) return title;
    const custom = (general ? generalTitles : professionalTitles)[title];
    return `${number}. ${custom ?? title.slice(number.length + 1)}`;
  };

  const sectionBody = (section: Snapshot['sections'][number]) => {
    if (/Учебно-тематическ/.test(section.title)) return [thematicTable()];
    const kind = sectionTable(section.title);
    if (kind === 'curriculum') return [curriculumTable()];
    if (kind === 'outcomes') return outcomesBlock();
    if (kind === 'working_programs') return workingPrograms();
    // Расписание и распределение часов в разделах хранятся строками с ключами
    // видов работы; в документе их заменяют таблицы с подписями шаблона.
    const replaced = kind === 'calendar' || kind === 'hours' ? replacedSectionField[kind] : '';
    // Перечень созданных материалов заменяет ссылка на приложение с самими материалами.
    const fields = (section.fields ?? [{ label: '', value: section.content }]).filter(
      (field) => field.label !== replaced && field.label !== 'Созданные оценочные материалы',
    );
    const result: (Paragraph | Table)[] = fields.flatMap((field) => {
      const lines = textLines(field.value);
      // Раздел из одного поля читается как обычный текст без подписи поля.
      if (fields.length === 1 || !field.label)
        return lines.length ? paragraphs(field.value) : [body(blank)];
      if (lines.length <= 1)
        return [body(sentence(`${field.label}: ${lines[0] ? continued(lines[0]) : blank}`))];
      return [subheading(`${field.label}:`), ...paragraphs(field.value)];
    });
    if (kind === 'calendar' && snapshot.skeleton.sessions?.length) result.push(calendarTable());
    return result;
  };

  const sections = snapshot.sections.filter((s) => s.title !== 'Титульный лист');
  const appendixSections = sections.filter((s) => /^Приложение/.test(s.title));
  const shownChapters = new Set<string>();
  const content: (Paragraph | Table)[] = [];
  for (const section of sections.filter((s) => !appendixSections.includes(s))) {
    const number = numberOf(section.title);
    // Главы («2. СОДЕРЖАНИЕ ПРОГРАММЫ», «2.5. Оценка качества…») в данных
    // отдельными разделами не хранятся, поэтому вставляются перед первым подразделом.
    const chapters = general ? generalChapters : professionalChapters;
    for (const prefix of number
      ? [number.split('.')[0], number.split('.').slice(0, 2).join('.')]
      : []) {
      if (prefix === number || shownChapters.has(prefix) || !chapters[prefix]) continue;
      shownChapters.add(prefix);
      content.push(heading(chapters[prefix], prefix.includes('.') ? 2 : 1));
    }
    if (/^Пояснительная записка/.test(section.title))
      content.push(heading('1. Пояснительная записка', 1));
    else content.push(heading(displayTitle(section.title), 2));
    content.push(...sectionBody(section));
    if (/Оценочные материалы/.test(section.title) && assessed.length)
      content.push(
        body(
          appendixSections.length
            ? 'Оценочные материалы для текущего контроля приведены в Приложении 1, для итоговой аттестации — в Приложении 2.'
            : 'Оценочные материалы приведены в Приложении 1.',
        ),
      );
  }

  const unconfirmed = unconfirmedSources(snapshot);
  if (unconfirmed.length)
    content.push(
      heading('Источники, требующие проверки', 2),
      body([
        new TextRun({
          text: 'Источники не подтверждены и не включены в списки литературы. Методист проверяет их перед утверждением.',
          italics: true,
        }),
      ]),
      ...listItems(
        unconfirmed.map((s) => `[НЕ ПОДТВЕРЖДЁН] ${s.name}${s.url ? `; ${s.url}` : ''}`),
      ),
    );

  if (appendixSections.length) {
    const current = assessed.filter((m) => !isFinal(m));
    const final = assessed.filter(isFinal);
    appendixSections.forEach((section, index) => {
      const isFinalAppendix = /Итогов/.test(section.title);
      content.push(
        ...appendixHeader(
          index + 1,
          isFinalAppendix
            ? 'Оценочные материалы для итоговой аттестации'
            : 'Оценочные материалы для текущего контроля',
        ),
        ...sectionBody(section),
        ...materialBlocks(isFinalAppendix ? final : current),
      );
    });
  } else if (assessed.length)
    content.push(...appendixHeader(1, 'Оценочные материалы'), ...materialBlocks(assessed));

  const document = new Document({
    creator: 'CourseOS',
    title: r.title,
    description: `Черновик версии ${snapshot.course_version} — требует проверки методистом`,
    numbering: {
      config: [
        {
          reference: dashList,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '–',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: layout.list } },
            },
          ],
        },
      ],
    },
    styles: {
      // Стиль «Обычный» повторяет базовые настройки документа: просмотр macOS
      // и Pages не читают docDefaults и без него показывают 12 пт без интервалов.
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          run: { font, size: layout.size },
          paragraph: {
            spacing: { line: layout.body.line, after: layout.body.after, before: 0 },
            indent: { firstLine: layout.body.firstLine },
          },
        },
      ],
      default: {
        document: {
          run: { font, size: layout.size },
          paragraph: {
            spacing: { line: layout.body.line, after: layout.body.after, before: 0 },
            indent: { firstLine: layout.body.firstLine },
          },
        },
        heading1: {
          run: { font, size: layout.chapter.size, bold: true, color: '000000' },
          paragraph: {
            keepNext: true,
            spacing: { before: layout.chapter.before, after: layout.chapter.after },
            indent: { firstLine: layout.heading.firstLine },
          },
        },
        heading2: {
          run: { font, size: layout.heading.size, bold: true, color: '000000' },
          paragraph: {
            keepNext: true,
            spacing: { before: layout.heading.before, after: layout.heading.after },
            indent: { firstLine: layout.heading.firstLine },
          },
        },
        heading3: {
          run: { font, size: layout.size, bold: true, color: '000000' },
          paragraph: {
            keepNext: true,
            spacing: { before: general ? 0 : 120, after: general ? 0 : 60 },
            indent: { firstLine: layout.heading.firstLine },
          },
        },
      },
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: layout.margin } },
        children: [...titlePage(snapshot, layout), ...content, ...reviewPage(snapshot)],
      },
    ],
  });
  return Packer.toBlob(document);
}

function titlePage(snapshot: Snapshot, layout: Layout) {
  const r = snapshot.skeleton.requirements;
  const general = layout === layouts.general;
  const line = (
    text: string,
    options: { bold?: boolean; size?: number; after?: number; align?: 'center' | 'right' } = {},
  ) =>
    new Paragraph({
      alignment: options.align === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER,
      indent: { firstLine: 0 },
      spacing: { after: options.after ?? (general ? 120 : 160), line: 240 },
      children: [new TextRun({ text, bold: options.bold, size: options.size })],
    });
  const gap = (twips: number) => new Paragraph({ spacing: { before: twips, after: 0 } });
  const programType = programTypeName(r).toUpperCase();
  // Реквизиты организации и приказа агент не заполняет: в образцах там
  // данные конкретной организации, их подставляет методист.
  return [
    line('Автономная некоммерческая организация', { bold: true }),
    line('дополнительного профессионального образования', { bold: true }),
    line(`«${blank}»`, { bold: true, size: general ? undefined : 28, after: general ? 120 : 80 }),
    ...(general ? [] : [line('___________________________________________', { after: 80 })]),
    line('ОГРН: ____________, ИНН/КПП: ____________', { size: general ? 24 : 20, after: 60 }),
    line('Адрес: ____________', { size: general ? 24 : 20, after: 400 }),
    line('УТВЕРЖДЕНО', { bold: !general, align: 'right', after: 60 }),
    line('Приказом № ____-ОБР от «___» __________ 20__ г.', {
      align: 'right',
      size: general ? undefined : 22,
      after: 600,
    }),
    gap(general ? 1200 : 600),
    line(programType, { bold: true, size: 28 }),
    line(`«${r.title}»`, { bold: true, size: general ? 28 : 26 }),
    // Город и год в образцах стоят внизу титульного листа.
    gap(general ? 5600 : 6600),
    line(`Черновик версии ${snapshot.course_version} — требует проверки методистом`, {
      size: 20,
    }),
    ...(general
      ? [line('____________ 20__', { bold: true, after: 0 })]
      : [line('____________', { after: 80 }), line('20__', { after: 0 })]),
    new Paragraph({ children: [new PageBreak()] }),
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
              indent: { firstLine: 0 },
              children: [
                new TextRun({ text: `☐ ${item.title}. `, bold: true }),
                new TextRun(item.detail),
              ],
            }),
        )
      : [new Paragraph('Открытых замечаний нет. Педагогическая экспертиза не проводилась.')]),
  ];
}
