import type { Requirements, Skeleton, Snapshot, Topic } from '../model/schema';
import { isInternship } from '../model/hours-plan';
import { hourTotals } from '../model/rules';
import { isProfessionalStandardReference } from '../model/professional-standards';
import { hourKinds, sumHours } from '../../../shared/lib/decimal';

type HourKind = (typeof hourKinds)[number];
export type CurriculumRow = {
  level: 'module' | 'topic' | 'total';
  // «1» для модуля, «1.2» для темы; у итоговой аттестации номера нет.
  number: string;
  title: string;
  total: string;
  hours: Record<HourKind, string>;
  control: string;
  topic?: Topic;
};

const finalModule = 'module-final';

const templateNames = {
  acr_professional: 'Дополнительная профессиональная программа повышения квалификации',
  acr_general: 'Дополнительная общеобразовательная общеразвивающая программа',
  unknown: 'Образовательная программа',
};
export function programTypeName(requirements: Requirements) {
  return `${templateNames[requirements.template_id]}${isInternship(requirements) ? ' в форме стажировки' : ''}`;
}

function hoursOf(topics: Topic[]) {
  return Object.fromEntries(
    hourKinds.map((kind) => [kind, sumHours(topics.map((t) => t.hours[kind]))]),
  ) as Record<HourKind, string>;
}

// Нумерация как в образцах АЦР: «Модуль 1. Название», затем «Тема 1.1.».
// Итоговая аттестация идёт отдельной строкой без модуля. Порядок модулей —
// порядок первого появления их тем, так же его видит методист в интерфейсе.
export function curriculumRows(skeleton: Skeleton): CurriculumRow[] {
  const modules = [...new Set(skeleton.topics.map((t) => t.module_id))];
  const moduleTitles = skeleton.requirements.model_design?.module_titles ?? [];
  let moduleNumber = 0;
  const rows = modules.flatMap((moduleId): CurriculumRow[] => {
    const topics = skeleton.topics.filter((t) => t.module_id === moduleId);
    if (moduleId === finalModule)
      return topics.map((topic) => ({
        level: 'topic',
        number: '',
        title: topic.title,
        total: topic.planned_total,
        hours: topic.hours,
        control: topic.control,
        topic,
      }));
    moduleNumber += 1;
    const number = String(moduleNumber);
    return [
      {
        level: 'module',
        number,
        title: moduleTitles[moduleNumber - 1] ?? '',
        total: sumHours(topics.map((t) => t.planned_total)),
        hours: hoursOf(topics),
        control: '',
      },
      ...topics.map((topic, index) => ({
        level: 'topic' as const,
        number: `${number}.${index + 1}`,
        title: topic.title,
        total: topic.planned_total,
        hours: topic.hours,
        control: topic.control,
        topic,
      })),
    ];
  });
  const totals = hourTotals(skeleton);
  rows.push({
    level: 'total',
    number: '',
    title: 'Итого',
    total: sumHours(Object.values(totals)),
    hours: totals,
    control: '',
  });
  return rows;
}

export function moduleHeading(row: CurriculumRow) {
  return `Модуль ${row.number}${row.title ? `. ${row.title}` : ''}`;
}
export function topicHeading(row: CurriculumRow) {
  return row.number ? `Тема ${row.number}. ${row.title}` : row.title;
}

// Виды работы, у которых в курсе есть хотя бы час. В читаемых выгрузках
// пустые колонки только мешают; в DOCX по шаблону АЦР показываются все.
export function usedHourKinds(skeleton: Skeleton) {
  const totals = hourTotals(skeleton);
  return hourKinds.filter((kind) => Number(totals[kind]) > 0);
}

// Какие разделы шаблона в выгрузке заменяются таблицей из структуры курса:
// в тексте разделов эти данные хранятся строками с ключами видов работы.
export function sectionTable(title: string) {
  if (/^2\.1 Учебный план/.test(title)) return 'curriculum';
  if (/Результаты обучения|Знания, умения/.test(title)) return 'outcomes';
  if (/Рабочие программы/.test(title)) return 'working_programs';
  if (/Календар/.test(title)) return 'calendar';
  if (/Объём/.test(title)) return 'hours';
  return null;
}
// Поле раздела, вместо которого показывается таблица.
export const replacedSectionField = { calendar: 'Расписание', hours: 'Распределение' } as const;

// Требование ТЗ: неподтверждённый источник нельзя выдавать за проверенный,
// поэтому такие источники во всех выгрузках идут отдельным помеченным списком.
export function unconfirmedSources(snapshot: Snapshot) {
  return snapshot.sources.filter(
    (s) =>
      !isProfessionalStandardReference(s) &&
      !(s.provenance?.content === 'confirmed' && s.provenance?.access === 'read'),
  );
}

export function formatDates(text: string) {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3.$2.$1');
}
