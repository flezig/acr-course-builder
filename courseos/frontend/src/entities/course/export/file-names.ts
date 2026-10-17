import type { Snapshot } from '../model/schema';

const parts = {
  md: 'программа и пояснения.md',
  json: 'данные курса.json',
  docx: 'программа АЦР.docx',
  pptx: 'слайды лекций.pptx',
  lms: 'тесты-moodle.xml',
};

// Имя файла называет курс и версию, а не внутренний id: методист скачивает
// несколько версий подряд и должен различать их в папке загрузок.
export function exportFileName(snapshot: Snapshot, format: keyof typeof parts) {
  const title = snapshot.skeleton.requirements.title
    .replace(/[\\/:*?"<>|«»]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${title || 'Курс'} — v${snapshot.course_version} — ${parts[format]}`;
}
