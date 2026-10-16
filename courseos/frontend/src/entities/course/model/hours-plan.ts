import Decimal from 'decimal.js';
import type { Requirements, Skeleton } from './schema';

// Шаг учебных часов взят из образцов АЦР: в интенсиве на 24 ч встречаются занятия по 0,5 ч,
// в стажировке на 248 ч все значения целые. Более мелких долей в образцах нет.
export const minimalHourStep = new Decimal('0.5');

export function isInternship(requirements: Requirements) {
  return requirements.delivery.toLowerCase().includes('стажиров');
}

export function hourStep(requirements: Requirements, hours: Decimal.Value) {
  const wholeHours = new Decimal(hours).mod(1).eq(0);
  return wholeHours && (isInternship(requirements) || new Decimal(hours).gte(100))
    ? new Decimal(1)
    : minimalHourStep;
}

export function isOnHourStep(value: Decimal.Value) {
  return new Decimal(value).mod(minimalHourStep).eq(0);
}

// Делит объём целыми шагами методом наибольшего остатка: сумма сходится точно,
// и ни одна позиция не «добирает» хвост округления за остальных.
export function allocateHours(total: Decimal.Value, weights: number[], step: Decimal.Value) {
  const units = new Decimal(total).div(step);
  if (!units.isInteger())
    throw new Error(`Объём ${total} ч нельзя разложить шагом ${step} ч без дробных остатков`);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return weights.map(() => new Decimal(0));
  const exact = weights.map((weight) => units.times(weight).div(weightTotal));
  const floors = exact.map((value) => value.floor());
  let left = units.minus(floors.reduce((sum, value) => sum.plus(value), new Decimal(0)));
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value.minus(floors[index]) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  for (const { index } of byRemainder) {
    if (left.lte(0)) break;
    floors[index] = floors[index].plus(1);
    left = left.minus(1);
  }
  return floors.map((value) => value.times(step));
}

type WorkSplit = { lecture: number; practice: number; self_study: number };
export type ModuleDesign = {
  title: string;
  weight: number;
  // Соотношение видов работы. Для банковского сценария это часы из методического решения,
  // для остальных — относительные доли по типу модуля.
  split: WorkSplit;
  reason: string;
};

// Вводный модуль опирается на объяснение, инструментальный — на практику,
// проектный — на самостоятельную работу с консультациями.
export const moduleProfiles = {
  intro: { lecture: 2, practice: 2, self_study: 1 },
  tool: { lecture: 1, practice: 2, self_study: 1 },
  project: { lecture: 0, practice: 1, self_study: 3 },
} satisfies Record<string, WorkSplit>;

export type ModuleHours = {
  lecture: Decimal;
  practice: Decimal;
  self_study: Decimal;
  total: Decimal;
  reason: string;
};

export function distributeModuleHours(
  requirements: Requirements,
  modules: ModuleDesign[],
  finalHours: Decimal,
): ModuleHours[] {
  const studyHours = new Decimal(requirements.total_hours).minus(finalHours);
  const step = hourStep(requirements, studyHours);
  const totals = allocateHours(
    studyHours,
    modules.map((module) => module.weight),
    step,
  );
  const remoteAllowed = selfStudyAllowed(requirements);
  return modules.map((module, index) => {
    if (isInternship(requirements))
      return {
        lecture: new Decimal(0),
        practice: new Decimal(0),
        self_study: totals[index],
        total: totals[index],
        reason: module.reason,
      };
    // При очной форме без дистанционной части самостоятельная доля уходит в практику:
    // в запросе нет часов, которые слушатель проводит вне занятий.
    const split = remoteAllowed
      ? module.split
      : {
          ...module.split,
          practice: module.split.practice + module.split.self_study,
          self_study: 0,
        };
    const [lecture, practice, self_study] = allocateHours(
      totals[index],
      [split.lecture, split.practice, split.self_study],
      step,
    );
    return { lecture, practice, self_study, total: totals[index], reason: module.reason };
  });
}

export function selfStudyAllowed(requirements: Requirements) {
  const delivery = requirements.delivery.toLowerCase();
  return (
    isInternship(requirements) ||
    delivery.includes('заоч') ||
    delivery.includes('дистанц') ||
    delivery.includes('дот')
  );
}

// Очные часы — занятия с преподавателем и итоговая аттестация; дистанционные — СРС.
// Для стажировки контактных часов нет: вся работа идёт под наставником на месте стажировки.
export function contactAndRemoteHours(skeleton: Skeleton) {
  const sum = (pick: (topic: Skeleton['topics'][number]) => Decimal.Value) =>
    skeleton.topics.reduce((total, topic) => total.plus(pick(topic)), new Decimal(0));
  const contact = sum((topic) =>
    new Decimal(topic.hours.lecture).plus(topic.hours.practice).plus(topic.hours.lab),
  );
  const selfStudy = sum((topic) => topic.hours.self_study);
  const assessment = sum((topic) => topic.hours.assessment);
  return { contact, selfStudy, assessment };
}

export type WeekLoad = {
  week: number;
  total: Decimal;
  contact: Decimal;
  remote: Decimal;
  assessment: Decimal;
};

// Недельная нагрузка считается только по назначенным занятиям. Вместимость не заменяет расписание.
export function weeklyLoad(skeleton: Skeleton): WeekLoad[] {
  const requirements = skeleton.requirements;
  const weeks = Math.max(1, Math.ceil(requirements.calendar.calendar_days / 7));
  if (!requirements.calendar.calendar_days || !requirements.total_hours) return [];
  if (skeleton.sessions?.length) {
    const start = Date.parse(`${requirements.calendar.start}T00:00:00Z`);
    const rows: WeekLoad[] = Array.from({ length: weeks }, (_, index) => ({
      week: index + 1,
      total: new Decimal(0),
      contact: new Decimal(0),
      remote: new Decimal(0),
      assessment: new Decimal(0),
    }));
    for (const session of skeleton.sessions) {
      const week = Math.floor((Date.parse(`${session.date}T00:00:00Z`) - start) / (7 * 86400000));
      if (!rows[week]) continue;
      const h = session.hours;
      rows[week].contact = rows[week].contact.plus(h.lecture).plus(h.practice).plus(h.lab);
      rows[week].remote = rows[week].remote.plus(h.self_study);
      rows[week].assessment = rows[week].assessment.plus(h.assessment);
      rows[week].total = rows[week].total
        .plus(h.lecture)
        .plus(h.practice)
        .plus(h.lab)
        .plus(h.self_study)
        .plus(h.assessment);
    }
    return rows;
  }
  return [];
}
