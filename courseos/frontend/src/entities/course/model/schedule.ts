import Decimal from 'decimal.js';
import type { Requirements, Skeleton } from './schema';
import { hourKinds, sumHours } from '../../../shared/lib/decimal';

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
  if (!sessions.length) return [];
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
        problems.push(`${topic.title}: часы расписания расходятся с планом`);
        break;
      }
    }
  if (sessions.some((session) => !skeleton.topics.some((topic) => topic.id === session.topic_id)))
    problems.push('Занятие ссылается на отсутствующую тему');
  return problems;
}
