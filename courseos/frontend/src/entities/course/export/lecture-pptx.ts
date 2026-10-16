import PptxGenJS from 'pptxgenjs';
import type { Snapshot } from '../model/schema';
import { formatHours } from '../../../shared/lib/decimal';

const font = 'Arial';
const accent = '2F5D50';

export async function buildLecturePptx(snapshot: Snapshot): Promise<Blob> {
  const r = snapshot.skeleton.requirements;
  const lectures = snapshot.materials.filter((m) => m.type === 'lecture' && m.slides.length);
  if (!lectures.length) throw new Error('В этой версии нет лекций со слайдами — выгружать нечего.');

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = r.title;
  pptx.company = 'Академия цифрового развития';

  const cover = pptx.addSlide();
  cover.background = { color: accent };
  cover.addText(r.title, {
    x: 0.8,
    y: 2.2,
    w: 11.7,
    h: 1.6,
    fontFace: font,
    fontSize: 36,
    bold: true,
    color: 'FFFFFF',
  });
  cover.addText(
    `${formatHours(r.total_hours)} ч · черновик версии ${snapshot.course_version}, требует проверки экспертом`,
    {
      x: 0.8,
      y: 4,
      w: 11.7,
      h: 0.6,
      fontFace: font,
      fontSize: 16,
      color: 'DDE8E4',
    },
  );

  for (const lecture of lectures) {
    const topic = snapshot.skeleton.topics.find((t) => t.id === lecture.topic_id);
    pptx.addSection({ title: topic?.title ?? lecture.title });
    const opening = pptx.addSlide({ sectionTitle: topic?.title ?? lecture.title });
    opening.addText(lecture.title, {
      x: 0.8,
      y: 2.6,
      w: 11.7,
      h: 1.2,
      fontFace: font,
      fontSize: 30,
      bold: true,
      color: accent,
    });
    if (topic) opening.addNotes(`План лекции: ${topic.content}`);

    for (const slide of lecture.slides) {
      const page = pptx.addSlide({ sectionTitle: topic?.title ?? lecture.title });
      page.addText(slide.title, {
        x: 0.6,
        y: 0.4,
        w: 12.1,
        h: 0.9,
        fontFace: font,
        fontSize: 26,
        bold: true,
        color: accent,
      });
      page.addText(
        slide.bullets.map((text) => ({ text, options: { bullet: true } })),
        {
          x: 0.8,
          y: 1.5,
          w: 11.7,
          h: 5.3,
          fontFace: font,
          fontSize: 18,
          valign: 'top',
          paraSpaceAfter: 8,
        },
      );
      // Пояснения преподавателя идут в заметки докладчика, чтобы не перегружать слайд.
      if (slide.notes) page.addNotes(slide.notes);
    }
  }
  return (await pptx.write({ outputType: 'blob' })) as Blob;
}
