import PptxGenJS from 'pptxgenjs';
import type { Snapshot } from '../model/schema';
import { formatHours, hourKinds, hourLabels } from '../../../shared/lib/decimal';
import { plural } from '../../../shared/lib/plural';
import { curriculumRows, programTypeName, topicHeading } from './curriculum';
import { outcomeCodes } from './outcome-codes';

const font = 'Arial';
const codeFont = 'Courier New';
const ink = '1A1F2E';
const accent = '2F6BFF';
const muted = '5B6475';
const soft = 'EEF2FB';
const contentMaster = 'CONTENT';

// Строка, где вне кавычек нет кириллицы, но есть скобки или присваивание, —
// фрагмент кода: его показываем моноширинным шрифтом.
const isCode = (text: string) => {
  const outsideQuotes = text.replace(/"[^"]*"|'[^']*'/g, '');
  return !/[а-яё]/i.test(outsideQuotes) && /[=():[\]{}]/.test(outsideQuotes);
};

export async function buildLecturePptx(snapshot: Snapshot): Promise<Blob> {
  const s = snapshot.skeleton;
  const r = s.requirements;
  const lectures = snapshot.materials.filter((m) => m.type === 'lecture' && m.slides.length);
  if (!lectures.length) throw new Error('В этой версии нет лекций со слайдами — выгружать нечего.');
  const codes = outcomeCodes(s);
  const rows = curriculumRows(s);
  const rowOf = (topicId: string) => rows.find((row) => row.topic?.id === topicId);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = r.title;
  pptx.company = 'Академия цифрового развития';
  pptx.defineSlideMaster({
    title: contentMaster,
    background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: accent } } },
      {
        text: {
          text: r.title,
          options: { x: 0.6, y: 7.0, w: 9, h: 0.3, fontFace: font, fontSize: 10, color: muted },
        },
      },
    ],
    slideNumber: { x: 12.2, y: 7.0, w: 0.6, h: 0.3, fontFace: font, fontSize: 10, color: muted },
  });

  const cover = pptx.addSlide();
  cover.background = { color: ink };
  cover.addShape('rect', { x: 0.8, y: 1.9, w: 0.12, h: 2.2, fill: { color: accent } });
  cover.addText(programTypeName(r), {
    x: 1.1,
    y: 1.8,
    w: 11.2,
    h: 0.5,
    fontFace: font,
    fontSize: 14,
    color: 'AEB8D0',
  });
  cover.addText(r.title, {
    x: 1.1,
    y: 2.3,
    w: 11.2,
    h: 1.8,
    fontFace: font,
    fontSize: 40,
    bold: true,
    color: 'FFFFFF',
    valign: 'top',
  });
  cover.addText(
    `Слайды лекций · ${lectures.length} ${plural(lectures.length, ['тема', 'темы', 'тем'])} · ${formatHours(r.total_hours)} ч`,
    { x: 1.1, y: 4.4, w: 11.2, h: 0.5, fontFace: font, fontSize: 18, color: 'DDE3F0' },
  );
  cover.addText(`Черновик версии ${snapshot.course_version} — требует проверки методистом`, {
    x: 1.1,
    y: 6.4,
    w: 11.2,
    h: 0.4,
    fontFace: font,
    fontSize: 12,
    color: 'AEB8D0',
  });

  const agenda = pptx.addSlide({ masterName: contentMaster });
  agenda.addText('Темы лекций', {
    x: 0.6,
    y: 0.4,
    w: 12.1,
    h: 0.8,
    fontFace: font,
    fontSize: 28,
    bold: true,
    color: ink,
  });
  const agendaItems = lectures.map((lecture) => {
    const row = rowOf(lecture.topic_id);
    return row ? topicHeading(row) : lecture.title;
  });
  // Длинный список делится на две колонки, чтобы не уменьшать шрифт.
  const half = agendaItems.length > 8 ? Math.ceil(agendaItems.length / 2) : agendaItems.length;
  [agendaItems.slice(0, half), agendaItems.slice(half)].forEach((column, index) => {
    if (!column.length) return;
    agenda.addText(
      column.map((text) => ({ text, options: { breakLine: true } })),
      {
        x: 0.6 + index * 6.1,
        y: 1.4,
        w: half === agendaItems.length ? 12.1 : 5.9,
        h: 5.4,
        fontFace: font,
        fontSize: agendaItems.length > 8 ? 16 : 20,
        color: ink,
        valign: 'top',
        paraSpaceAfter: 10,
      },
    );
  });

  for (const lecture of lectures) {
    const topic = s.topics.find((t) => t.id === lecture.topic_id);
    const row = rowOf(lecture.topic_id);
    const sectionTitle = topic?.title ?? lecture.title;
    pptx.addSection({ title: sectionTitle });

    const opening = pptx.addSlide({ masterName: contentMaster, sectionTitle });
    opening.background = { color: soft };
    if (row?.number)
      opening.addText(`Тема ${row.number}`, {
        x: 0.8,
        y: 1.3,
        w: 11.7,
        h: 0.5,
        fontFace: font,
        fontSize: 18,
        bold: true,
        color: accent,
      });
    opening.addText(sectionTitle, {
      x: 0.8,
      y: 1.8,
      w: 11.7,
      h: 1.4,
      fontFace: font,
      fontSize: 36,
      bold: true,
      color: ink,
      valign: 'top',
    });
    const outcomes = s.outcomes.filter((o) => lecture.outcome_ids.includes(o.id));
    if (outcomes.length)
      opening.addText(
        [
          { text: 'Результаты обучения по теме', options: { bold: true, breakLine: true } },
          ...outcomes.map((o) => ({
            text: `${codes[o.id]} — ${o.description}`,
            options: { breakLine: true },
          })),
        ],
        {
          x: 0.8,
          y: 3.5,
          w: 11.7,
          h: 2.4,
          fontFace: font,
          fontSize: 18,
          color: ink,
          valign: 'top',
          paraSpaceAfter: 6,
        },
      );
    if (topic)
      opening.addText(
        `${formatHours(topic.planned_total)} ч: ${hourKinds
          .filter((kind) => Number(topic.hours[kind]) > 0)
          .map((kind) => `${hourLabels[kind].toLowerCase()} ${formatHours(topic.hours[kind])}`)
          .join(', ')}`,
        { x: 0.8, y: 6.1, w: 11.7, h: 0.4, fontFace: font, fontSize: 14, color: muted },
      );
    if (topic) opening.addNotes(`План лекции: ${topic.content}\nФорма контроля: ${topic.control}`);

    for (const slide of lecture.slides) {
      const page = pptx.addSlide({ masterName: contentMaster, sectionTitle });
      page.addText(slide.title, {
        x: 0.6,
        y: 0.4,
        w: 12.1,
        h: 0.9,
        fontFace: font,
        fontSize: 28,
        bold: true,
        color: ink,
        valign: 'middle',
      });
      page.addShape('rect', { x: 0.6, y: 1.32, w: 0.9, h: 0.06, fill: { color: accent } });
      const long = slide.bullets.length > 6 || slide.bullets.join('').length > 450;
      const short = slide.bullets.length <= 4 && slide.bullets.join('').length < 200;
      page.addText(
        slide.bullets.map((text) => ({
          text,
          options: isCode(text)
            ? { fontFace: codeFont, color: '1F3A8A', bullet: { indent: 18 }, breakLine: true }
            : { bullet: { indent: 18 }, breakLine: true },
        })),
        {
          x: 0.6,
          y: 1.6,
          w: 12.1,
          h: 5.2,
          fontFace: font,
          fontSize: long ? 16 : short ? 24 : 20,
          color: ink,
          valign: 'top',
          paraSpaceAfter: 10,
          fit: 'shrink',
        },
      );
      // Пояснения преподавателя идут в заметки докладчика, чтобы не перегружать слайд.
      if (slide.notes) page.addNotes(slide.notes);
    }
  }
  // pptxgenjs отдаёт архив с типом application/zip; браузеру и почте нужен тип презентации.
  const archive = (await pptx.write({ outputType: 'blob' })) as Blob;
  return new Blob([archive], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
