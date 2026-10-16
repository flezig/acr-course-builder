import { useForm } from 'react-hook-form';
import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import type { Snapshot, Requirements } from '../../entities/course/model/schema';
import { calendarCalculation } from '../../entities/course/model/rules';
import {
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import './calendar-panel.css';
import {
  buildSessions,
  scheduleCalculation,
  scheduleProblems,
} from '../../entities/course/model/schedule';
import { useCommand } from '../../entities/course/api/provider';
import { Form, ErrorMessage, Field, Panel } from '../../shared/ui/ui';

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
  const [choice, setOption] = useState<Option | null>(null);
  const form = useForm<Requirements['calendar']>({
    mode: 'onChange',
    defaultValues: {
      ...snapshot.skeleton.requirements.calendar,
      confirmed: false,
      same_units: true,
    },
  });
  useEffect(() => {
    form.reset({ ...snapshot.skeleton.requirements.calendar, confirmed: false });
    setOption(null);
  }, [snapshot.course_version, form]);
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
  // Объём программы и нагрузка заданы в академических часах.
  const normalized = {
    ...calendar,
    schedule: calendar.schedule?.confirmed ? calendar.schedule : undefined,
    daily_limit: valid ? calendar.daily_limit.replace(',', '.') : '0',
    same_units: true,
  };
  const requirements = {
    ...snapshot.skeleton.requirements,
    calendar: { ...normalized, calendar_days: valid ? calendar.calendar_days : 0 },
  };
  const capacity = calendarCalculation(requirements);
  const scheduled = scheduleCalculation(requirements.calendar, requirements.total_hours);
  const calc = scheduled ?? capacity;
  const total = hours(requirements.total_hours);
  const deficit = new Decimal(calc.deficit).gt(0);
  const originalLimit = snapshot.skeleton.requirements.calendar.daily_limit;
  const requestedRaise =
    valid && !!originalLimit && new Decimal(normalized.daily_limit).gt(originalLimit);
  const option = requestedRaise ? 'raise' : valid && !deficit ? 'confirm' : choice;
  const storedProblems = scheduleProblems(snapshot.skeleton);
  const previewSessions = valid ? buildSessions(snapshot.skeleton, normalized) : [];
  const assigned = previewSessions.reduce(
    (sum, session) => sum.plus(Decimal.sum(...Object.values(session.hours))),
    new Decimal(0),
  );
  const result = structuredClone(requirements.calendar);
  if (valid && !scheduled?.error && option === 'extend') {
    if (!scheduled && calendar.weekdays_only && calc.needed !== null) {
      result.calendar_days = Math.min(
        3650,
        result.calendar_days + Math.floor(Math.max(calc.needed - calc.days, 0) / 5) * 7,
      );
    } else if (calc.needed !== null) {
      result.calendar_days = Math.min(3650, Math.max(result.calendar_days, calc.needed));
    }
    let available = (
      scheduleCalculation(result, requirements.total_hours) ??
      calendarCalculation({ ...requirements, calendar: result })
    ).days;
    while (calc.needed !== null && available < calc.needed) {
      if (result.calendar_days >= 3650) break;
      result.calendar_days++;
      available = (
        scheduleCalculation(result, requirements.total_hours) ??
        calendarCalculation({ ...requirements, calendar: result })
      ).days;
    }
  }
  if (valid && !requestedRaise && option === 'raise' && calc.minimumLimit) {
    result.daily_limit = Decimal.max(normalized.daily_limit, calc.minimumLimit).toString();
    if (result.schedule?.confirmed) result.schedule.duration = calc.minimumLimit;
  }
  const applicable = (id: Option) =>
    id === 'confirm' ||
    (id === 'raise' && requestedRaise) ||
    (deficit &&
      (id !== 'reduce' || new Decimal(calc.capacity).gte(16)) &&
      (id !== 'raise' || calc.days > 0));
  const resultTotal =
    option === 'reduce' && applicable('reduce') ? calc.capacity : requirements.total_hours;
  const resultCalc =
    scheduleCalculation(result, resultTotal) ??
    calendarCalculation({
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
    raise:
      scheduled && !requestedRaise
        ? 'Подтверждаю увеличение длительности занятий'
        : 'Как методист, согласен с увеличением дневной нагрузки',
  };
  const submit = form.handleSubmit(async () => {
    if (!option || !applicable(option) || !valid || scheduled?.error || !calendar.confirmed) return;
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
      /* Сохраняем введённые параметры для повторной попытки. */
    }
  });
  const options: { id: Option; title: string; description: string }[] = [
    {
      id: 'extend',
      title: 'Продлить календарь',
      description: `Минимум ${calc.needed ?? '—'} ${scheduled ? 'дней с занятиями' : 'учебных дней'}. Объём ${total} уч. ч. сохранится`,
    },
    {
      id: 'reduce',
      title: 'Сократить объём',
      description: `Снизить объём с ${total} до ${hours(calc.capacity)} уч. ч. Программа потребует пересмотра и утверждения`,
    },
    {
      id: 'raise',
      title: scheduled ? 'Увеличить длительность занятия' : 'Увеличить дневную нагрузку',
      description: scheduled
        ? `Занятие ${hours(normalized.schedule!.duration)} → ${calc.minimumLimit ? hours(calc.minimumLimit) : '—'} уч. ч. Дневной лимит: ${hours(normalized.daily_limit)} → ${calc.minimumLimit ? hours(Decimal.max(normalized.daily_limit, calc.minimumLimit).toString()) : '—'} уч. ч.`
        : `Дневной лимит ${snapshot.skeleton.requirements.original_limits?.daily_limit || snapshot.skeleton.requirements.calendar.daily_limit || 'не задан'} → ${calc.minimumLimit || '—'} уч. ч. Требуется повторное утверждение.`,
    },
    {
      id: 'confirm',
      title: 'Сохранить с нехваткой часов',
      description: `Блокировка утверждения сохранится. В календаре не хватает ${hours(calc.deficit)} уч. ч.`,
    },
  ];
  return (
    <div id="calendar">
      <Panel className="calendar-panel">
        <div className="calendar-heading">
          <div>
            <span className="calendar-eyebrow">
              <CalendarDays size={15} /> Планирование обучения
            </span>
            <h2>Календарь и учебная нагрузка</h2>
            <p>Настройте срок и занятия. Расписание сверяется с часами учебного плана.</p>
          </div>
          {!readonly && (
            <button
              type="button"
              className="calendar-toggle"
              onClick={() => {
                form.reset({ ...snapshot.skeleton.requirements.calendar, confirmed: false });
                setOption(null);
                setEditing(!editing);
              }}
            >
              {editing ? 'Отменить' : 'Изменить календарь'}
            </button>
          )}
        </div>
        <div
          className={`calendar-overview ${valid && (deficit || scheduled?.error || storedProblems.length) ? 'needs-attention' : ''}`}
        >
          <div className="calendar-overview-title">
            {valid && !deficit && !scheduled?.error && !storedProblems.length ? (
              <CheckCircle2 size={19} />
            ) : (
              <AlertCircle size={19} />
            )}
            <div>
              <strong>
                {!valid
                  ? 'Настройте календарь'
                  : scheduled?.error
                    ? 'Проверьте параметры занятий'
                    : deficit
                      ? `Не хватает ${hours(calc.deficit)} уч. ч.${scheduled ? ' в расписании' : ''}`
                      : storedProblems.length
                        ? 'Расписание нужно пересобрать'
                        : snapshot.skeleton.requirements.calendar.confirmed
                          ? 'Календарь согласован с учебным планом'
                          : 'Календарь готов к подтверждению'}
              </strong>
              <p>
                {!valid
                  ? 'Укажите дату начала, срок и дневную нагрузку.'
                  : scheduled?.error ||
                    (deficit
                      ? 'Продлите срок, измените дни занятий или их длительность.'
                      : storedProblems.length
                        ? 'Сохраните календарь, чтобы распределить часы актуального плана по занятиям.'
                        : scheduled
                          ? 'Все часы помещаются в выбранные дни занятий.'
                          : 'Объём помещается в календарь. Даты отдельных занятий можно настроить ниже.')}
              </p>
            </div>
          </div>
          {valid && (
            <dl className="calendar-metrics">
              <div>
                <dt>Объём программы</dt>
                <dd>
                  {total}
                  <small> уч. ч.</small>
                </dd>
              </div>
              <div>
                <dt>{scheduled ? 'Помещается в расписание' : 'Вместимость календаря'}</dt>
                <dd>
                  {hours(calc.capacity)}
                  <small> уч. ч.</small>
                </dd>
              </div>
              <div>
                <dt>{scheduled ? 'Распределено по темам' : 'Учебных дней'}</dt>
                <dd>
                  {scheduled ? hours(assigned.toString()) : calc.days}
                  <small>
                    {scheduled ? ` из ${total} уч. ч.` : ` из ${calendar.calendar_days}`}
                  </small>
                </dd>
              </div>
            </dl>
          )}
          {!editing &&
            !readonly &&
            (deficit ||
              storedProblems.length > 0 ||
              !snapshot.skeleton.requirements.calendar.confirmed) && (
              <button type="button" className="calendar-fix" onClick={() => setEditing(true)}>
                Настроить календарь <ArrowRight size={15} />
              </button>
            )}
        </div>
        {!readonly && editing && (
          <Form
            errors={form.formState.errors}
            submitCount={form.formState.submitCount}
            className="calendar-form"
            noValidate
            onSubmit={submit}
            onChange={(event) => {
              if (
                event.target instanceof HTMLInputElement &&
                (['start', 'calendar_days', 'daily_limit', 'weekdays_only'].includes(
                  event.target.name,
                ) ||
                  event.target.name.startsWith('schedule.'))
              ) {
                form.setValue('confirmed', false);
                setOption(null);
              }
            }}
          >
            <h3 className="calendar-section-title">Период обучения</h3>
            <div className="form-grid">
              <Field label="Дата начала">
                <input
                  type="date"
                  {...form.register('start', {
                    validate: (value) => validDate(value) || 'Укажите корректную дату начала',
                  })}
                  required
                />
              </Field>
              <Field label="Календарных дней" hint="Продолжительность включает выходные.">
                <input
                  type="number"
                  min="1"
                  max="3650"
                  step="1"
                  {...form.register('calendar_days', {
                    valueAsNumber: true,
                    validate: (value) =>
                      (Number.isInteger(value) && value > 0 && value <= 3650) ||
                      'Введите целое число от 1 до 3650',
                  })}
                  required
                />
              </Field>
              <Field label="Максимум часов в день">
                <input
                  inputMode="decimal"
                  {...form.register('daily_limit', {
                    validate: (value) =>
                      validLimit(value) || 'Введите количество часов больше нуля',
                  })}
                  pattern="\d+(?:[.,]\d+)?"
                  required
                />
              </Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" {...form.register('weekdays_only')} /> Только будни
            </label>
            <details
              className="calendar-schedule"
              open={!!calendar.schedule?.confirmed || undefined}
            >
              <summary>
                Расписание занятий <span>Дни недели и длительность</span>
              </summary>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={!!calendar.schedule?.confirmed}
                  onChange={(e) => {
                    form.setValue('schedule', {
                      weekdays: calendar.schedule?.weekdays || [3, 6],
                      sessions_per_week: calendar.schedule?.sessions_per_week || 2,
                      duration: calendar.schedule?.duration || '2',
                      confirmed: e.target.checked,
                    });
                    form.setValue('confirmed', false);
                  }}
                />
                Назначить занятия по темам учебного плана
              </label>
              {scheduled?.error && (
                <p className="calendar-shortfall" role="alert">
                  {scheduled.error}
                </p>
              )}
              {calendar.schedule?.confirmed && (
                <>
                  <Field label="Длительность занятия в часах">
                    <input {...form.register('schedule.duration')} inputMode="decimal" />
                  </Field>
                  <fieldset className="calendar-weekdays">
                    <legend>Дни проведения</legend>
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                      <label className="checkbox" key={day}>
                        <input
                          type="checkbox"
                          checked={calendar.schedule?.weekdays.includes(day) || false}
                          onChange={(e) => {
                            const days = calendar.schedule?.weekdays || [];
                            const selected = e.target.checked
                              ? [...days, day]
                              : days.filter((d) => d !== day);
                            form.setValue('schedule.weekdays', selected);
                            form.setValue('schedule.sessions_per_week', selected.length);
                            setOption(null);
                            form.setValue('confirmed', false);
                          }}
                        />
                        <span>{['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][day]}</span>
                      </label>
                    ))}
                  </fieldset>
                  <p>
                    {calendar.schedule.weekdays.length} занятий в неделю. Темы распределяются по
                    порядку учебного плана, включая итоговую аттестацию.
                  </p>
                </>
              )}
            </details>
            <p className="calendar-hint">
              Все значения указаны в академических часах. Выходные входят в календарный срок;
              «Только будни» исключает занятия по субботам и воскресеньям.
            </p>
            <div
              className={`calendar-problem ${valid && deficit ? 'has-deficit' : ''}`}
              role="status"
              aria-live="polite"
            >
              {valid ? (
                <>
                  <p>
                    {new Date(`${calendar.start}T00:00:00Z`).toLocaleDateString('ru-RU', {
                      timeZone: 'UTC',
                    })}{' '}
                    — {endDate(calendar)} · {calendar.calendar_days} календарных дней · {calc.days}{' '}
                    {scheduled ? 'дней с занятиями' : 'учебных дней'}
                  </p>
                  <strong>
                    Нужно {total} уч. ч., доступно {hours(calc.capacity)} уч. ч.
                    {deficit ? ` Не хватает ${hours(calc.deficit)} уч. ч.` : ' Часов достаточно'}
                  </strong>
                  <p>
                    {deficit
                      ? 'Выберите решение ниже: изменить срок, объём или дневную нагрузку либо сохранить календарь с дефицитом.'
                      : 'Подтвердите параметры и сохраните календарь. Расписание пересоберётся автоматически.'}
                  </p>
                </>
              ) : (
                'Заполните параметры для расчёта'
              )}
            </div>
            {(deficit || !valid) && (
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
                {options
                  .filter((item) => (!valid ? item.id === 'confirm' : applicable(item.id)))
                  .map((item) => (
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
                        {item.id === 'extend' && (
                          <span className="calendar-recommendation">Рекомендуется</span>
                        )}
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
            )}
            {valid && (
              <>
                {option && (option !== 'confirm' || deficit) && applicable(option) && (
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
                          {scheduled && (
                            <div>
                              <dt>Длительность занятия</dt>
                              <dd>
                                {hours(normalized.schedule!.duration)} уч. ч.
                                {result.schedule?.duration !== normalized.schedule?.duration
                                  ? ` → ${hours(result.schedule!.duration)} уч. ч.`
                                  : ' — без изменений'}
                              </dd>
                            </div>
                          )}
                        </dl>
                        {new Decimal(resultCalc.deficit).gt(0) ? (
                          <p className="calendar-shortfall">
                            Нехватка {hours(resultCalc.deficit)} уч. ч. сохранится.{' '}
                            {result.calendar_days >= 3650 &&
                              'Достигнут максимальный срок 3650 дней. Измените нагрузку или объём.'}{' '}
                            Перед утверждением программы потребуется решить нехватку часов.
                          </p>
                        ) : (
                          <p>Часов будет достаточно.</p>
                        )}
                        {option === 'reduce' && (
                          <p>Программа потребует пересмотра и утверждения.</p>
                        )}
                        {option === 'raise' && (
                          <p>
                            Меняется исходное ограничение. Нагрузка выше, времени на отдых меньше.
                            Требуется повторное утверждение структуры программы.
                          </p>
                        )}
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
                    !!scheduled?.error ||
                    (option === 'extend' && new Decimal(resultCalc.deficit).gt(0)) ||
                    (option === 'reduce' && new Decimal(calc.capacity).lt(16))
                  }
                  type="submit"
                >
                  {command.isPending
                    ? 'Сохраняем…'
                    : deficit
                      ? 'Применить и пересчитать'
                      : 'Сохранить календарь'}
                </button>
              </>
            )}
            <ErrorMessage error={command.error} />
          </Form>
        )}
        {valid && (
          <CalendarLoad
            skeleton={snapshot.skeleton}
            calendar={normalized}
            totalHours={requirements.total_hours}
            deficit={calc.deficit}
          />
        )}
      </Panel>
    </div>
  );
}

function CalendarLoad({
  skeleton,
  calendar,
  totalHours,
  deficit,
}: {
  skeleton: Snapshot['skeleton'];
  calendar: Requirements['calendar'];
  totalHours: string;
  deficit: string;
}) {
  const [week, setWeek] = useState(0);
  const maxWeek = Math.ceil(calendar.calendar_days / 7) - 1;
  const selectedWeek = Math.min(week, maxWeek);
  const limit = new Decimal(calendar.daily_limit);
  const sessions = buildSessions(skeleton, calendar);
  const start = new Date(`${calendar.start}T00:00:00Z`);
  const hasDeficit = new Decimal(deficit).gt(0);
  const cells = [];

  for (let day = 0; day < Math.min((selectedWeek + 1) * 7, calendar.calendar_days); day++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + day);
    const off = calendar.weekdays_only && [0, 6].includes(date.getUTCDay());
    const daySessions = sessions.filter((s) => s.date === date.toISOString().slice(0, 10));
    const load = daySessions.reduce(
      (sum, s) =>
        sum
          .plus(s.hours.lecture)
          .plus(s.hours.practice)
          .plus(s.hours.lab)
          .plus(s.hours.self_study)
          .plus(s.hours.assessment),
      new Decimal(0),
    );
    if (day >= selectedWeek * 7)
      cells.push({ date, off, load, daySessions, last: day === calendar.calendar_days - 1 });
  }
  return (
    <section className="calendar-load" aria-label="Расчёт учебной нагрузки по дням">
      <div className="load-heading">
        <div>
          <h3>Нагрузка по дням</h3>
          <p>
            {sessions.length
              ? `Расписание занятий · объём ${hours(totalHours)} ч`
              : 'Вместимость проверена; расписание не составлено'}
          </p>
        </div>
        <div className="week-switch">
          <button
            type="button"
            aria-label="Предыдущая неделя"
            disabled={selectedWeek === 0}
            onClick={() => setWeek(selectedWeek - 1)}
          >
            <ChevronLeft size={16} />
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
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="load-days">
        {cells.map(({ date, off, load, daySessions, last }) => (
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
              <span
                style={{ width: `${Decimal.min(load.div(limit).times(100), 100).toNumber()}%` }}
              />
            </div>
            <span>
              {off
                ? 'Выходной'
                : sessions.length
                  ? `${hours(load.toString())} уч. ч.`
                  : 'Не назначено'}
            </span>
            {daySessions.map((s) => (
              <small key={s.id}>
                {skeleton.topics.find((t) => t.id === s.topic_id)?.title} ·{' '}
                {Object.entries(s.hours)
                  .filter(([, v]) => Number(v) > 0)
                  .map(
                    ([k, v]) =>
                      `${({ lecture: 'ЛК', practice: 'ПР', lab: 'ЛБ', self_study: 'СРС', assessment: 'ИА' } as Record<string, string>)[k]} ${v}`,
                  )
                  .join(', ')}
              </small>
            ))}
            {last && hasDeficit && <small>! Не хватает часов</small>}
          </div>
        ))}
      </div>
      {sessions.length > 0 && (
        <p>
          Сумма недели {selectedWeek + 1}:{' '}
          {hours(cells.reduce((sum, cell) => sum.plus(cell.load), new Decimal(0)).toString())} ч.
          Темы и виды работы показаны в днях занятий.
        </p>
      )}
      <p className={hasDeficit ? 'load-conflict' : 'load-note'}>
        {hasDeficit
          ? `⚠ Дефицит вместимости ${hours(deficit)} уч. ч. — измените срок или дневную нагрузку.`
          : 'Объём помещается в календарь.'}{' '}
        {sessions.length
          ? 'Дни и недели рассчитаны по занятиям; итоговая аттестация включена один раз.'
          : 'Расчёт показывает вместимость; даты отдельных занятий не заданы.'}
      </p>
    </section>
  );
}
