import { useForm } from 'react-hook-form';
import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import type { Snapshot, Requirements } from '../../entities/course/model/schema';
import { calendarCalculation } from '../../entities/course/model/rules';
import { useCommand } from '../../entities/course/api/provider';
import { ErrorMessage, Field, Panel } from '../../shared/ui/ui';

type Option = 'confirm' | 'extend' | 'reduce' | 'raise';
const hours = (value: string) =>
  new Decimal(value).toNumber().toLocaleString('ru-RU', { maximumFractionDigits: 6 });
function dailyHours(value: string) {
  if (!value) return 'нагрузка не задана';
  return `${hours(value)} уч. ч. в день`;
}
function endDate(calendar: Requirements['calendar']) {
  const date = new Date(`${calendar.start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + calendar.calendar_days - 1);
  return date.toLocaleDateString('ru-RU', { timeZone: 'UTC' });
}
export function CalendarPanel({
  snapshot,
  readonly,
  focusIssue = false,
  saved,
}: {
  snapshot: Snapshot;
  readonly: boolean;
  focusIssue?: boolean;
  saved?: () => void;
}) {
  const command = useCommand();
  const [editing, setEditing] = useState(false);
  const [option, setOption] = useState<Option | null>(null);
  const form = useForm<Requirements['calendar']>({
    mode: 'onTouched',
    defaultValues: {
      ...snapshot.skeleton.requirements.calendar,
      confirmed: false,
      same_units: true,
    },
  });
  useEffect(() => {
    if (!focusIssue) {
      setEditing(false);
      return;
    }
    if (readonly) return;
    setEditing(true);
    const frame = requestAnimationFrame(() => {
      const calendar = snapshot.skeleton.requirements.calendar;
      form.setFocus(
        !calendar.start ? 'start' : calendar.calendar_days < 1 ? 'calendar_days' : 'daily_limit',
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [focusIssue, readonly, form, snapshot]);
  const calendar = form.watch();
  const errors = form.formState.errors;
  const validDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  const validLimit = (value: string) =>
    /^\d+(?:[.,]\d+)?$/.test(value) && new Decimal(value.replace(',', '.')).gt(0);
  const fields = [
    {
      name: 'start',
      label: 'дату начала',
      missing: !calendar.start,
      valid: validDate(calendar.start),
    },
    {
      name: 'calendar_days',
      label: 'число дней',
      missing: Number.isNaN(calendar.calendar_days) || calendar.calendar_days == null,
      valid:
        Number.isInteger(calendar.calendar_days) &&
        calendar.calendar_days > 0 &&
        calendar.calendar_days <= 3650,
    },
    {
      name: 'daily_limit',
      label: 'максимум часов в день',
      missing: !calendar.daily_limit.trim(),
      valid: validLimit(calendar.daily_limit),
    },
  ] as const;
  const missingFields = fields.filter((field) => field.missing);
  const invalidFields = fields.filter((field) => !field.valid && !field.missing);
  const valid = fields.every((field) => field.valid);
  const blockingReason = [
    missingFields.length
      ? `укажите ${missingFields.map((field) => field.label).join(', ')} выше`
      : '',
    invalidFields.length
      ? `исправьте ${invalidFields.map((field) => field.label).join(', ')} выше`
      : '',
  ]
    .filter(Boolean)
    .join('; ');
  const focusFirstIncomplete = () => {
    const first = fields.find((field) => !field.valid);
    if (!first) return;
    document
      .querySelector<HTMLInputElement>(`.calendar-form input[name="${first.name}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.setFocus(first.name);
  };
  // Both inputs use the same hour unit defined by the requirements contract.
  const normalized = {
    ...calendar,
    daily_limit: valid ? calendar.daily_limit.replace(',', '.') : '0',
    same_units: true,
  };
  const requirements = {
    ...snapshot.skeleton.requirements,
    calendar: { ...normalized, calendar_days: valid ? calendar.calendar_days : 0 },
  };
  const calc = calendarCalculation(requirements);
  const total = hours(requirements.total_hours);
  const deficit = new Decimal(calc.deficit).gt(0);
  const result = { ...requirements.calendar };
  if (valid && option === 'extend') {
    if (calendar.weekdays_only && calc.needed !== null) {
      result.calendar_days += Math.floor(Math.max(calc.needed - calc.days, 0) / 5) * 7;
    } else if (calc.needed !== null) {
      result.calendar_days = Math.max(result.calendar_days, calc.needed);
    }
    let available = calendarCalculation({ ...requirements, calendar: result }).days;
    while (calc.needed !== null && available < calc.needed) {
      result.calendar_days++;
      available = calendarCalculation({ ...requirements, calendar: result }).days;
    }
  }
  if (valid && option === 'raise' && calc.minimumLimit) result.daily_limit = calc.minimumLimit;
  const applicable = (id: Option) =>
    id === 'confirm' ||
    (deficit &&
      (id !== 'reduce' || new Decimal(calc.capacity).gte(16)) &&
      (id !== 'raise' || calc.days > 0));
  const resultTotal =
    option === 'reduce' && applicable('reduce') ? calc.capacity : requirements.total_hours;
  const resultCalc = calendarCalculation({
    ...requirements,
    total_hours: resultTotal,
    calendar: result,
  });
  const confirmations: Record<Option, string> = {
    confirm: deficit
      ? 'Подтверждаю сохранение календаря с нехваткой часов'
      : 'Подтверждаю даты и учебные дни',
    extend: 'Подтверждаю изменение срока обучения',
    reduce: 'Подтверждаю сокращение объёма и необходимость пересмотра и утверждения программы',
    raise: 'Как методист, согласен с увеличением дневной нагрузки',
  };
  const submit = form.handleSubmit(async () => {
    if (!option || !applicable(option) || !valid || !calendar.confirmed) return;
    try {
      await command.mutateAsync({
        action: 'resolve_calendar',
        expected_version: snapshot.course_version,
        payload: { calendar: normalized, option },
      });
      form.setValue('confirmed', false);
      setEditing(false);
      saved?.();
    } catch {
      /* Keep entered parameters on error. */
    }
  });
  const options: { id: Option; title: string; description: string }[] = [
    {
      id: 'confirm',
      title: 'Сохранить текущий календарь',
      description: `${calc.days} учебных дней, ${hours(calc.capacity)} уч. ч. ${deficit ? `Нехватка ${hours(calc.deficit)} уч. ч. сохранится` : 'Часов достаточно'}`,
    },
    {
      id: 'extend',
      title: 'Продлить календарь',
      description: `Минимум ${calc.needed ?? '—'} учебных дней. Объём ${total} уч. ч. сохранится`,
    },
    {
      id: 'reduce',
      title: 'Сократить объём',
      description: `Снизить объём с ${total} до ${hours(calc.capacity)} уч. ч. Программа потребует пересмотра и утверждения`,
    },
    {
      id: 'raise',
      title: 'Увеличить дневную нагрузку',
      description: `Не менее ${calc.minimumLimit ? dailyHours(calc.minimumLimit) : '—'}. Требуется согласие методиста`,
    },
  ];
  return (
    <div id="calendar">
      <Panel className="calendar-panel">
        <div className="calendar-heading">
          <h2>Календарь и учебная нагрузка</h2>
          {!readonly && (
            <button type="button" className="calendar-toggle" onClick={() => setEditing(!editing)}>
              {editing ? 'Закрыть календарь' : 'Изменить календарь'}
            </button>
          )}
        </div>
        {!editing && (
          <div className="calendar-summary" role="status">
            {valid ? (
              <>
                <p>
                  {calendar.start} — {endDate(calendar)} · {calendar.calendar_days} календарных дней
                  · {calc.days} учебных дней
                </p>
                <p>
                  Доступно {hours(calc.capacity)} уч. ч. · необходимо {total} уч. ч.
                </p>
                <p>
                  {deficit
                    ? `Не хватает ${hours(calc.deficit)} уч. ч. Откройте календарь и выберите решение.`
                    : calendar.confirmed || snapshot.skeleton.requirements.calendar.confirmed
                      ? 'Календарь подтверждён'
                      : 'Часов достаточно. Откройте календарь для подтверждения.'}
                </p>
              </>
            ) : (
              <p>Заполните параметры для расчёта</p>
            )}
          </div>
        )}
        {valid && (
          <CalendarLoad
            calendar={normalized}
            totalHours={requirements.total_hours}
            deficit={calc.deficit}
          />
        )}
        {!readonly && editing && (
          <form
            className={`calendar-form ${focusIssue ? 'field-highlight' : ''}`}
            noValidate
            onSubmit={submit}
            onChange={(event) => {
              if (
                event.target instanceof HTMLInputElement &&
                ['start', 'calendar_days', 'daily_limit', 'weekdays_only'].includes(
                  event.target.name,
                )
              ) {
                form.setValue('confirmed', false);
                setOption(null);
              }
            }}
          >
            <div className="form-grid">
              <Field label="Дата начала">
                <input
                  type="date"
                  aria-invalid={!!errors.start}
                  aria-describedby={errors.start ? 'calendar-start-error' : undefined}
                  {...form.register('start', {
                    validate: (value) => validDate(value) || 'Укажите корректную дату начала',
                  })}
                  required
                />
                {errors.start && (
                  <small id="calendar-start-error" className="field-error">
                    {errors.start.message}
                  </small>
                )}
              </Field>
              <Field label="Календарных дней">
                <input
                  type="number"
                  min="1"
                  max="3650"
                  step="1"
                  aria-invalid={!!errors.calendar_days}
                  aria-describedby={
                    errors.calendar_days ? 'calendar-days-error' : 'calendar-days-hint'
                  }
                  {...form.register('calendar_days', {
                    valueAsNumber: true,
                    validate: (value) =>
                      (Number.isInteger(value) && value > 0 && value <= 3650) ||
                      'Введите целое число от 1 до 3650',
                  })}
                  required
                />
                <small id="calendar-days-hint">Продолжительность включает выходные.</small>
                {errors.calendar_days && (
                  <small id="calendar-days-error" className="field-error">
                    {errors.calendar_days.message}
                  </small>
                )}
              </Field>
              <Field label="Максимум часов в день">
                <input
                  inputMode="decimal"
                  aria-invalid={!!errors.daily_limit}
                  aria-describedby={errors.daily_limit ? 'calendar-limit-error' : undefined}
                  {...form.register('daily_limit', {
                    validate: (value) =>
                      validLimit(value) || 'Введите количество часов больше нуля',
                  })}
                  pattern="\d+(?:[.,]\d+)?"
                  required
                />
                {errors.daily_limit && (
                  <small id="calendar-limit-error" className="field-error">
                    {errors.daily_limit.message}
                  </small>
                )}
              </Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" {...form.register('weekdays_only')} /> Только будни
            </label>
            <p className="calendar-hint">
              Только будни: учебными считаются понедельник–пятница. Выходные входят в календарный
              срок, но не добавляют учебных часов. Без этой настройки каждый календарный день
              считается учебным.
            </p>
            <div
              className={`calendar-problem ${valid && deficit ? 'has-deficit' : ''}`}
              role="status"
              aria-live="polite"
            >
              {valid ? (
                <>
                  <p>
                    {calendar.start} — {endDate(calendar)} · {calendar.calendar_days} календарных
                    дней · {calc.days} учебных дней
                  </p>
                  <strong>
                    Нужно {total} уч. ч., доступно {hours(calc.capacity)} уч. ч.
                    {deficit ? ` Не хватает ${hours(calc.deficit)} уч. ч.` : ' Часов достаточно'}
                  </strong>
                  <p>
                    {deficit
                      ? 'Выберите решение ниже: изменить срок, объём или дневную нагрузку либо сохранить календарь с дефицитом.'
                      : 'Выберите сохранение календаря и подтвердите параметры.'}
                  </p>
                </>
              ) : (
                'Заполните параметры для расчёта'
              )}
            </div>
            <fieldset
              className="resolution-options"
              aria-describedby={!valid ? 'calendar-blocking-reason' : undefined}
            >
              <legend>Выбор решения</legend>
              {!valid && (
                <div className="resolution-blocking">
                  <p id="calendar-blocking-reason" role="status" aria-live="polite">
                    Чтобы выбрать решение, {blockingReason}
                  </p>
                  <button type="button" onClick={focusFirstIncomplete}>
                    {missingFields.length === 1 &&
                    missingFields[0].name === 'calendar_days' &&
                    !invalidFields.length
                      ? 'Указать число дней'
                      : 'Заполнить параметры'}
                  </button>
                </div>
              )}
              {options.map((item) => (
                <label
                  key={item.id}
                  className={`resolution ${option === item.id ? 'selected' : ''} ${!valid || !applicable(item.id) || command.isPending ? 'is-disabled' : ''}`}
                >
                  <input
                    type="radio"
                    name="calendar-option"
                    value={item.id}
                    disabled={!valid || !applicable(item.id) || command.isPending}
                    checked={option === item.id}
                    onChange={() => {
                      setOption(item.id);
                      form.setValue('confirmed', false);
                    }}
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <span className="resolution-description">
                      {!valid
                        ? null
                        : !applicable(item.id)
                          ? item.id === 'reduce' && deficit
                            ? 'Вместимость меньше минимальных 16 уч. ч. Продлите календарь или увеличьте нагрузку.'
                            : 'Изменение не требуется: часов достаточно либо нет учебных дней.'
                          : item.description}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {valid && (
              <>
                {option && applicable(option) && (
                  <div
                    className="calendar-result"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    <h3>Итог выбранного решения</h3>
                    {option && valid && applicable(option) ? (
                      <>
                        <dl>
                          <div>
                            <dt>Срок обучения</dt>
                            <dd>
                              {endDate(calendar)}
                              {result.calendar_days !== calendar.calendar_days
                                ? ` → ${endDate(result)}`
                                : ' — без изменений'}
                              ; {resultCalc.days} учебных дней
                            </dd>
                          </div>
                          <div>
                            <dt>Объём</dt>
                            <dd>
                              {total}
                              {resultTotal !== requirements.total_hours
                                ? ` → ${hours(resultTotal)}`
                                : ''}{' '}
                              ч{resultTotal === requirements.total_hours ? ' — без изменений' : ''}
                            </dd>
                          </div>
                          <div>
                            <dt>Дневная нагрузка</dt>
                            <dd>
                              {dailyHours(normalized.daily_limit)}
                              {result.daily_limit !== normalized.daily_limit
                                ? ` → ${dailyHours(result.daily_limit)}`
                                : ' — без изменений'}
                            </dd>
                          </div>
                        </dl>
                        {new Decimal(resultCalc.deficit).gt(0) ? (
                          <p className="calendar-shortfall">
                            Нехватка {hours(resultCalc.deficit)} уч. ч. сохранится. Перед
                            утверждением программы потребуется решить нехватку часов.
                          </p>
                        ) : (
                          <p>Часов будет достаточно.</p>
                        )}
                        {option === 'reduce' && (
                          <p>Программа потребует пересмотра и утверждения.</p>
                        )}
                        {option === 'raise' && <p>Требуется согласие методиста.</p>}
                        {option === 'reduce' && new Decimal(calc.capacity).lt(16) && (
                          <p className="calendar-shortfall">
                            Объём должен быть не менее 16 уч. ч. Измените параметры.
                          </p>
                        )}
                      </>
                    ) : (
                      <p>Выберите доступное решение, чтобы увидеть изменения.</p>
                    )}
                  </div>
                )}
                {option && applicable(option) && (
                  <label className="checkbox calendar-confirmation">
                    <input
                      type="checkbox"
                      {...form.register('confirmed')}
                      disabled={!valid || !applicable(option) || command.isPending}
                    />{' '}
                    {confirmations[option]}
                  </label>
                )}
                <button
                  className="primary"
                  disabled={
                    command.isPending ||
                    !valid ||
                    !option ||
                    (option !== null && !applicable(option)) ||
                    !calendar.confirmed ||
                    (option === 'reduce' && new Decimal(calc.capacity).lt(16))
                  }
                  type="submit"
                >
                  {command.isPending ? 'Применяем решение…' : 'Применить и пересчитать'}
                </button>
              </>
            )}
            <ErrorMessage error={command.error} />
          </form>
        )}
      </Panel>
    </div>
  );
}

function CalendarLoad({
  calendar,
  totalHours,
  deficit,
}: {
  calendar: Requirements['calendar'];
  totalHours: string;
  deficit: string;
}) {
  const [week, setWeek] = useState(0);
  const maxWeek = Math.ceil(calendar.calendar_days / 7) - 1;
  const selectedWeek = Math.min(week, maxWeek);
  const limit = new Decimal(calendar.daily_limit);
  const total = new Decimal(totalHours);
  const start = new Date(`${calendar.start}T00:00:00Z`);
  const hasDeficit = new Decimal(deficit).gt(0);
  const cells = [];
  let assigned = new Decimal(0);
  for (let day = 0; day < Math.min((selectedWeek + 1) * 7, calendar.calendar_days); day++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + day);
    const off = calendar.weekdays_only && [0, 6].includes(date.getUTCDay());
    const load = off ? new Decimal(0) : Decimal.min(limit, Decimal.max(total.minus(assigned), 0));
    assigned = assigned.plus(load);
    if (day >= selectedWeek * 7)
      cells.push({ date, off, load, last: day === calendar.calendar_days - 1 });
  }
  return (
    <section className="calendar-load" aria-label="Расчёт учебной нагрузки по дням">
      <div className="load-heading">
        <div>
          <h3>Нагрузка по дням</h3>
          <p>Расчёт по дневному лимиту · {hours(calendar.daily_limit)} уч. ч. в день</p>
        </div>
        <div className="week-switch">
          <button
            type="button"
            aria-label="Предыдущая неделя"
            disabled={selectedWeek === 0}
            onClick={() => setWeek(selectedWeek - 1)}
          >
            ←
          </button>
          <span>
            Неделя {selectedWeek + 1} из {maxWeek + 1}
          </span>
          <button
            type="button"
            aria-label="Следующая неделя"
            disabled={selectedWeek === maxWeek}
            onClick={() => setWeek(selectedWeek + 1)}
          >
            →
          </button>
        </div>
      </div>
      <div className="load-days">
        {cells.map(({ date, off, load, last }) => (
          <div
            className={`load-day ${off ? 'day-off' : ''} ${last && hasDeficit ? 'day-conflict' : ''}`}
            key={date.toISOString()}
          >
            <small>{date.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' })}</small>
            <strong>
              {date.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'short',
                timeZone: 'UTC',
              })}
            </strong>
            <div className="load-bar">
              <span style={{ width: `${load.div(limit).times(100).toNumber()}%` }} />
            </div>
            <span>{off ? 'Выходной' : `${hours(load.toString())} уч. ч.`}</span>
            {last && hasDeficit && <small>! Не хватает часов</small>}
          </div>
        ))}
      </div>
      <p className={hasDeficit ? 'load-conflict' : 'load-note'}>
        {hasDeficit
          ? `⚠ Не размещено ${hours(deficit)} уч. ч. — измените срок или дневную нагрузку.`
          : 'Объём помещается в календарь.'}{' '}
        Расчёт показывает вместимость; даты отдельных занятий не заданы.
      </p>
    </section>
  );
}
