import { describe, expect, it } from 'vitest';
import { calendarFromRequest, standardScenario } from '../src/agent/headless';

const parameters = {
  title: 'Первые шаги в Python',
  template_id: 'acr_general' as const,
  audience: 'Школьники',
  entry_level: 'Без опыта',
  goal: 'Программировать',
  total_hours: '16',
  delivery: 'Очно',
  assessment: 'Защита проекта',
  constraints: '',
  weeks: null,
  daily_limit: '',
};
// Суббота: ближайший понедельник — 19 октября.
const now = new Date('2026-10-17T12:00:00Z');

describe('срок и расписание для API агента', () => {
  it('строит расписание «два раза в неделю по 2 часа» на 4 недели', () => {
    const { calendar } = calendarFromRequest(
      'Объем 16 часов, занятия очно по 2 часа два раза в неделю.',
      parameters,
      now,
    );
    expect(calendar).toMatchObject({
      start: '2026-10-19',
      calendar_days: 28,
      daily_limit: '2',
      confirmed: true,
      schedule: { weekdays: [2, 4], sessions_per_week: 2, duration: '2', confirmed: true },
    });
  });

  it('без срока предлагает его сам и сообщает об этом', () => {
    const { calendar, assumptions } = calendarFromRequest(
      'Курс на 36 часов',
      {
        ...parameters,
        total_hours: '36',
      },
      now,
    );
    expect(calendar.calendar_days).toBe(14);
    expect(calendar.confirmed).toBe(false);
    expect(assumptions[0]).toMatch(/Срок обучения не указан: агент предложил 2 нед\./);
  });

  it('профстандарт берётся только из каталога и только для ПК', () => {
    expect(standardScenario(parameters)).toBeNull();
    expect(
      standardScenario({
        ...parameters,
        template_id: 'acr_professional',
        title: 'ИИ в работе учителя',
      }),
    ).toBe('teachers');
    expect(
      standardScenario({ ...parameters, template_id: 'acr_professional', title: 'DevOps-инженер' }),
    ).toBe('devops');
    expect(
      standardScenario({ ...parameters, template_id: 'acr_professional', title: 'Бухучёт' }),
    ).toBeNull();
  });

  it('«около двух месяцев» при 4 ч в день продлевается до 64 дней для 256 ч', () => {
    const { calendar, assumptions } = calendarFromRequest(
      'Стажировка на 256 часов. Срок около двух месяцев, не больше 4 часов в день.',
      { ...parameters, total_hours: '256', daily_limit: '4' },
      now,
    );
    expect(calendar.calendar_days).toBe(64);
    expect(assumptions[1]).toMatch(/уточнён до 64 дней/);
  });
});
