import Decimal from 'decimal.js';
import type { Requirements, Skeleton } from './schema';
import { hourKinds, sumHours } from '../../../shared/lib/decimal';

export function scheduleCalculation(calendar: Requirements['calendar'], totalHours: string) {
  const schedule = calendar.schedule;
  if (!schedule?.confirmed) return null;
  const durationText = schedule.duration.replace(',', '.');
  const duration = /^\d+(?:\.\d+)?$/.test(durationText)
    ? new Decimal(durationText)
    : new Decimal(0);
  const weekdays = new Set(schedule.weekdays);
  let error = '';
  if (!weekdays.size || weekdays.size !== schedule.sessions_per_week)
    error = 'Выберите столько дней недели, сколько занятий запланировано в неделю.';
  else if (calendar.weekdays_only && [...weekdays].some((day) => day === 0 || day === 6))
    error = 'Уберите выходные из дней занятий или отключите «Только будни».';
  else if (!duration.gt(0)) error = 'Укажите длительность занятия больше нуля.';
  else if (duration.gt(calendar.daily_limit || 0))
    error =
      'Длительность занятия превышает дневной лимит. Уменьшите её или согласуйте новый лимит.';
  let days = 0;
  const start = new Date(`${calendar.start}T00:00:00Z`);
  for (let day = 0; day < calendar.calendar_days; day++) {
    const weekday = new Date(start.getTime() + day * 86400000).getUTCDay();
    if (weekdays.has(weekday) && (!calendar.weekdays_only || ![0, 6].includes(weekday))) days++;
  }
  const total = new Decimal(totalHours || 0);
  const capacity = duration.times(days);
  return {
    days,
    capacity: capacity.toString(),
    deficit: Decimal.max(total.minus(capacity), 0).toString(),
    needed: duration.gt(0) ? total.div(duration).ceil().toNumber() : null,
    minimumLimit: days ? total.div(days).div('0.5').ceil().times('0.5').toString() : null,
    error,
  };
}

export function buildSessions(
  skeleton: Skeleton,
  calendar: Requirements['calendar'] = skeleton.requirements.calendar,
): NonNullable<Skeleton['sessions']> {
  const schedule = calendar.schedule;
  const duration = schedule?.duration.replace(',', '.') || '';
  if (
    !schedule?.confirmed ||
    !calendar.start ||
    !/^\d+(?:[.,]\d+)?$/.test(duration) ||
    Number(duration) <= 0 ||
    !calendar.daily_limit ||
    new Decimal(duration).gt(calendar.daily_limit) ||
    new Set(schedule.weekdays).size !== schedule.sessions_per_week
  )
    return [];
  const dates: string[] = [];
  const start = new Date(`${calendar.start}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return [];
  for (let day = 0; day < calendar.calendar_days; day++) {
    const date = new Date(start.getTime() + day * 86400000);
    if (
      schedule.weekdays.includes(date.getUTCDay()) &&
      (!calendar.weekdays_only || ![0, 6].includes(date.getUTCDay()))
    )
      dates.push(date.toISOString().slice(0, 10));
  }
  const sessions: NonNullable<Skeleton['sessions']> = [];
  let slot = 0;
  let free = new Decimal(duration);
  for (const topic of skeleton.topics) {
    const remaining = { ...topic.hours };
    while (new Decimal(sumHours(Object.values(remaining))).gt(0) && slot < dates.length) {
      const hours = { lecture: '0', practice: '0', lab: '0', self_study: '0', assessment: '0' };
      for (const kind of hourKinds) {
        const chunk = Decimal.min(remaining[kind], free);
        hours[kind] = chunk.toString();
        remaining[kind] = new Decimal(remaining[kind]).minus(chunk).toString();
        free = free.minus(chunk);
      }
      sessions.push({
        id: `session-${sessions.length + 1}`,
        date: dates[slot],
        topic_id: topic.id,
        hours,
      });
      if (free.eq(0)) {
        slot++;
        free = new Decimal(duration);
      }
    }
  }
  return sessions;
}

export function scheduleProblems(skeleton: Skeleton) {
  const sessions = skeleton.sessions || [];
  const scheduled = scheduleCalculation(
    skeleton.requirements.calendar,
    skeleton.requirements.total_hours,
  );
  if (scheduled?.error) return [scheduled.error];
  if (scheduled && new Decimal(scheduled.deficit).gt(0))
    return [
      `По выбранным дням и длительности помещается ${scheduled.capacity} из ${skeleton.requirements.total_hours} уч. ч.; не хватает ${scheduled.deficit} уч. ч.`,
    ];
  if (!sessions.length && !scheduled) return [];
  const problems: string[] = [];
  const calendar = skeleton.requirements.calendar;
  const dates = [...new Set(sessions.map((s) => s.date))];
  for (const date of dates) {
    const load = sumHours(
      sessions.filter((s) => s.date === date).flatMap((s) => Object.values(s.hours)),
    );
    if (new Decimal(load).gt(calendar.daily_limit || 0))
      problems.push(`${date}: превышен дневной лимит`);
  }
  for (const topic of skeleton.topics)
    for (const kind of hourKinds) {
      const actual = sumHours(
        sessions.filter((s) => s.topic_id === topic.id).map((s) => s.hours[kind]),
      );
      if (!new Decimal(actual).eq(topic.hours[kind])) {
        problems.push(
          `${topic.title}: в расписании ${sumHours(sessions.filter((s) => s.topic_id === topic.id).flatMap((s) => Object.values(s.hours)))} из ${sumHours(Object.values(topic.hours))} уч. ч.; виды работы должны совпадать с планом`,
        );
        break;
      }
    }
  if (sessions.some((session) => !skeleton.topics.some((topic) => topic.id === session.topic_id)))
    problems.push('Занятие ссылается на отсутствующую тему');
  return problems;
}
