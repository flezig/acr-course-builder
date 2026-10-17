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
      confirmed: false,
      schedule: { weekdays: [2, 4], sessions_per_week: 2, duration: '2', confirmed: false },
    });
  });

  it('сохраняет явные дату и дни вместо ближайшего понедельника и шаблонных дней', () => {
    const { calendar, assumptions } = calendarFromRequest(
      'Курс на 72 часа. Начало 10 ноября 2026 года, 2 раза в неделю по понедельникам и средам, по 4 часа.',
      { ...parameters, total_hours: '72', weeks: 9 },
      now,
    );
    expect(calendar).toMatchObject({
      start: '2026-11-10',
      calendar_days: 63,
      confirmed: true,
      schedule: { weekdays: [1, 3], sessions_per_week: 2, duration: '4', confirmed: true },
    });
    expect(assumptions).toEqual([]);
  });

  it.each(['2026-11-10', '10.11.2026', '10/11/2026', '10 ноября 2026 года'])(
    'понимает дату начала в формате %s и сохраняет её без расписания',
    (date) => {
      const { calendar, assumptions } = calendarFromRequest(
        `Начало обучения: ${date}. Курс на 16 часов, 4 недели.`,
        { ...parameters, weeks: 4 },
        now,
      );
      expect(calendar.start).toBe('2026-11-10');
      expect(assumptions).toEqual([]);
    },
  );

  it('выводит число занятий из дней и не включает день сдачи проекта в расписание', () => {
    const { calendar } = calendarFromRequest(
      'Старт 10.11.2026. Занятия по вторникам и четвергам по 2 часа. Сдача проекта в пятницу.',
      parameters,
      now,
    );
    expect(calendar.schedule).toEqual({
      weekdays: [2, 4],
      sessions_per_week: 2,
      duration: '2',
      confirmed: true,
    });
    expect(calendar.confirmed).toBe(true);
  });

  it('сохраняет выходные и сокращённые названия дней', () => {
    const { calendar } = calendarFromRequest(
      'С 10 ноября 2026 занятия по ср, сб и вс, три раза в неделю по 2 часа.',
      parameters,
      now,
    );
    expect(calendar.schedule?.weekdays).toEqual([3, 6, 0]);
  });

  it.each([
    ['пн–пт', [1, 2, 3, 4, 5]],
    ['пт–пн', [5, 6, 0, 1]],
  ])('понимает диапазон дней %s, включая переход через воскресенье', (days, expected) => {
    const { calendar } = calendarFromRequest(
      `Начало 10.11.2026. Занятия по ${days} по 2 часа.`,
      parameters,
      now,
    );
    expect(calendar.schedule?.weekdays).toEqual(expected);
    expect(calendar.schedule?.sessions_per_week).toBe(expected.length);
  });

  it('сохраняет дни без длительности занятия, а предложенную длительность требует подтвердить', () => {
    const { calendar, assumptions } = calendarFromRequest(
      'Начало 10 ноября 2026, понедельник и среда.',
      parameters,
      now,
    );
    expect(calendar.start).toBe('2026-11-10');
    expect(calendar.schedule?.weekdays).toEqual([1, 3]);
    expect(calendar.schedule?.confirmed).toBe(false);
    expect(calendar.confirmed).toBe(false);
    expect(assumptions).toEqual([expect.stringMatching(/Длительность занятия не указана/)]);
  });

  it.each([
    ['10 ноября', '2026-11-10'],
    ['10.11', '2026-11-10'],
    ['10 января', '2027-01-10'],
  ])('для даты без года «%s» предлагает ближайшее наступление и сообщает год', (date, start) => {
    const { calendar, assumptions } = calendarFromRequest(
      `Начало ${date}, занятия по понедельникам и средам по 2 часа.`,
      parameters,
      now,
    );
    expect(calendar.start).toBe(start);
    expect(calendar.confirmed).toBe(false);
    expect(assumptions).toEqual([expect.stringMatching(/Год начала не указан/)]);
  });

  it.each(['31 ноября 2026', '29.02.2027', '2026-13-10'])(
    'требует уточнить некорректную дату %s вместо переноса на другую дату',
    (date) => {
      expect(() => calendarFromRequest(`Начало ${date}`, parameters, now)).toThrow(
        /Дата начала.*некорректна/,
      );
    },
  );

  it('требует уточнить противоречие между частотой и перечисленными днями', () => {
    expect(() =>
      calendarFromRequest(
        'Начало 10.11.2026, 3 раза в неделю по понедельникам и средам по 2 часа.',
        parameters,
        now,
      ),
    ).toThrow(/3 занятий в неделю, но дней занятий — 2/);
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
