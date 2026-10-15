import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  skeletonSchema,
  courseHoursSchema,
  type Skeleton,
  type Snapshot,
} from '../../entities/course/model/schema';
import { hourKinds, hourLabels } from '../../shared/lib/decimal';
import { useCommand } from '../../entities/course/api/provider';
import { Form, Field, Panel, ErrorMessage, Notice } from '../../shared/ui/ui';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';
import './skeleton-editor.css';
import { kindLabels, assessmentLabels } from '../../entities/course/model/presets';
export function SkeletonEditor({
  snapshot: currentSnapshot,
  close,
  saved,
  focusTarget,
}: {
  snapshot: Snapshot;
  close: () => void;
  saved?: () => void;
  focusTarget?: string;
}) {
  const [snapshot] = useState(currentSnapshot);
  const key = `courseos-skeleton-draft-${snapshot.mode}-${snapshot.course_id}-${snapshot.course_version}`;
  const form = useForm<Skeleton>({
    mode: 'onChange',
    resolver: zodResolver(
      skeletonSchema.extend({
        requirements: skeletonSchema.shape.requirements.extend({ total_hours: courseHoursSchema }),
      }),
    ),
    defaultValues: (() => {
      try {
        return JSON.parse(localStorage.getItem(key) || 'null') || snapshot.skeleton;
      } catch {
        return snapshot.skeleton;
      }
    })(),
  });
  const outcomes = useFieldArray({
    control: form.control,
    name: 'outcomes',
    keyName: 'form_key',
  });
  const currentOutcomes = form.watch('outcomes');
  const currentAssessments = form.watch('assessments');
  const removeOutcome = (index: number) => {
    const removedId = form.getValues(`outcomes.${index}.id`);
    for (const collection of ['topics', 'activities', 'assessments'] as const) {
      form.getValues(collection).forEach((item, itemIndex) => {
        form.setValue(
          `${collection}.${itemIndex}.outcome_ids`,
          item.outcome_ids.filter((id) => id !== removedId),
          { shouldDirty: true },
        );
      });
    }
    outcomes.remove(index);
  };
  const assessments = useFieldArray({
    control: form.control,
    name: 'assessments',
    keyName: 'form_key',
  });
  const activities = useFieldArray({
    control: form.control,
    name: 'activities',
    keyName: 'form_key',
  });
  const command = useCommand();
  useUnsavedChanges(form.formState.isDirty && !command.isSuccess);
  useEffect(() => {
    const subscription = form.watch((values) => localStorage.setItem(key, JSON.stringify(values)));
    return () => subscription.unsubscribe();
  }, [form, key]);
  useEffect(() => {
    if (!focusTarget) return;
    const index = snapshot.skeleton.topics.findIndex((topic) => topic.id === focusTarget);
    if (
      snapshot.skeleton.outcomes.some((outcome) => outcome.id === focusTarget) ||
      snapshot.skeleton.assessments.some((assessment) => assessment.id === focusTarget)
    ) {
      const assessment = snapshot.skeleton.assessments.findIndex(
        (item) => item.id === focusTarget || item.outcome_ids.includes(focusTarget),
      );
      const details = document.querySelector<HTMLDetailsElement>('.assessment-plan-editor');
      if (details) details.open = true;
      if (assessment >= 0) {
        form.setFocus(`assessments.${assessment}.criterion`);
        const field = document.querySelector<HTMLInputElement>(
          `input[name="assessments.${assessment}.criterion"]`,
        );
        field?.classList.add('field-highlight');
        field?.scrollIntoView({ block: 'center' });
      } else document.querySelector<HTMLButtonElement>('.assessment-plan-editor > button')?.focus();
      return;
    }
    if (index < 0) return;
    form.setFocus(`topics.${index}.hours.practice`);
    const field = document.querySelector<HTMLInputElement>(
      `input[name="topics.${index}.hours.practice"]`,
    );
    field?.classList.add('field-highlight');
    field?.scrollIntoView({ block: 'center' });
  }, [focusTarget, form, snapshot]);
  const submit = form.handleSubmit(async (values) => {
    try {
      await command.mutateAsync({
        action: 'save_skeleton',
        expected_version: snapshot.course_version,
        payload: values,
      });
      localStorage.removeItem(key);
      (saved || close)();
    } catch {
      /* После конфликта версии несохранённый черновик остаётся в браузере. */
    }
  });
  return (
    <Panel
      title="Редактирование программы"
      subtitle="Изменение создаёт новую ревизию и пересчитывает объяснения. Старое утверждение перестаёт применяться."
    >
      {currentSnapshot.course_version !== snapshot.course_version && (
        <Notice tone="warning">
          Текущая версия изменилась. Ваш черновик версии {snapshot.course_version} сохранён; его
          нельзя применить поверх новых данных. Закройте редактор и откройте актуальную версию.
        </Notice>
      )}
      <Form
        errors={form.formState.errors}
        submitCount={form.formState.submitCount}
        onSubmit={submit}
      >
        <Field label="Цель">
          <textarea {...form.register('goal')} rows={2} required />
        </Field>
        <div className="form-grid">
          <Field label="Аудитория">
            <input {...form.register('requirements.audience')} required />
          </Field>
          <Field label="Входной уровень">
            <input {...form.register('requirements.entry_level')} required />
          </Field>
          <Field label="Общий объём, часы">
            <input {...form.register('requirements.total_hours')} inputMode="decimal" required />
          </Field>
          <Field label="Аттестация">
            <input {...form.register('requirements.assessment')} required />
          </Field>
        </div>
        <h3>Результаты обучения</h3>
        {outcomes.fields.map((outcome, index) => (
          <div className="outcome-editor" key={outcome.form_key}>
            <Field label={`Результат ${index + 1}`}>
              <textarea {...form.register(`outcomes.${index}.description`)} rows={2} required />
            </Field>
            <Field label={`Категория результата ${index + 1}`}>
              <select {...form.register(`outcomes.${index}.kind`)}>
                {Object.entries(kindLabels).map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              className="link-button"
              disabled={outcomes.fields.length <= 1}
              onClick={() => removeOutcome(index)}
            >
              Удалить результат {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            outcomes.append({
              id: `outcome-${crypto.randomUUID()}`,
              kind: 'skill',
              description: '',
              requirement_id: 'request',
              prerequisite: form.getValues('requirements.entry_level'),
              depth: '',
              professional_standard_code: null,
            })
          }
        >
          Добавить результат обучения
        </button>
        <p className="muted">
          Новый результат свяжите с темами и оценочным средством. При удалении результата его связи
          удаляются; задания и темы сохраняются.
        </p>
        <div className="table-scroll skeleton-topics-editor">
          <table>
            <thead>
              <tr>
                <th>Тема / содержание</th>
                {hourKinds.map((kind) => (
                  <th key={kind}>{hourLabels[kind]}</th>
                ))}
                <th>Заявлено</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.skeleton.topics.map((topic, index) => (
                <tr key={topic.id}>
                  <th>
                    <Field>
                      <input
                        aria-label={`Название темы ${index + 1}`}
                        {...form.register(`topics.${index}.title`)}
                        required
                      />
                    </Field>
                    <Field>
                      <textarea
                        aria-label={`Содержание темы ${index + 1}`}
                        className="topic-content-input"
                        {...form.register(`topics.${index}.content`)}
                        rows={2}
                      />
                    </Field>
                    <Controller
                      control={form.control}
                      name={`topics.${index}.outcome_ids`}
                      render={({ field }) => (
                        <OutcomePicker
                          label={`Результаты темы ${index + 1}`}
                          outcomes={currentOutcomes}
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </th>
                  {hourKinds.map((kind) => (
                    <td key={kind} data-label={hourLabels[kind]}>
                      <Field>
                        <input
                          className="hour-input"
                          aria-label={`Тема ${index + 1}: ${hourLabels[kind]}`}
                          {...form.register(`topics.${index}.hours.${kind}`)}
                          inputMode="decimal"
                          required
                        />
                      </Field>
                    </td>
                  ))}
                  <td data-label="Заявлено">
                    <Field>
                      <input
                        className="hour-input"
                        aria-label={`Заявленный объём темы ${index + 1}`}
                        {...form.register(`topics.${index}.planned_total`)}
                        inputMode="decimal"
                        required
                      />
                    </Field>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="assessment-plan-editor">
          <summary>Оценочные материалы</summary>
          <p className="muted">
            Проверьте, каким заданием и по какому критерию оценивается каждый результат обучения.
            На этапе каркаса агент предлагает краткие описания заданий и критерии оценки. Полные
            условия и материалы появятся после утверждения каркаса.
          </p>
          {assessments.fields.map((assessment, index) => (
            <div key={assessment.form_key} className="assessment-editor">
              <strong>
                Оценочное средство {index + 1} ·{' '}
                {assessmentLabels[currentAssessments[index]?.type || assessment.type]}
              </strong>
              <div className="form-grid">
                <Field label="Вид оценочного средства">
                  <select {...form.register(`assessments.${index}.type`)}>
                    {(
                      [
                        'test',
                        'practical',
                        'project',
                        'portfolio',
                        'exam',
                        'mentor_interview',
                      ] as const
                    ).map((type) => (
                      <option key={type} value={type}>
                        {assessmentLabels[type]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Controller
                  control={form.control}
                  name={`assessments.${index}.outcome_ids`}
                  render={({ field }) => (
                    <OutcomePicker
                      label="Проверяемые результаты обучения (можно выбрать несколько)"
                      outcomes={currentOutcomes}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>
              <Field label="Задание">
                <input {...form.register(`assessments.${index}.action`)} required />
              </Field>
              <Field label="Критерии оценки">
                <input {...form.register(`assessments.${index}.criterion`)} required />
              </Field>
              <button
                type="button"
                className="assessment-remove-button"
                onClick={() => assessments.remove(index)}
              >
                Удалить оценочное средство {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="primary assessment-add-button"
            onClick={() =>
              assessments.append({
                id: `assessment-${crypto.randomUUID()}`,
                topic_id: 'topic-final',
                outcome_ids: [currentOutcomes[0].id],
                type: 'project',
                action: '',
                criterion: '',
              })
            }
          >
            Добавить оценочное средство
          </button>
        </details>
        <details>
          <summary>Активности для освоения результатов</summary>
          <p className="muted">
            Это учебные задания, на которых слушатели осваивают результаты: например, практикум или
            разбор кейса. Их предлагает агент; заполнять заново не нужно — измените, если требуется
            другой способ обучения.
          </p>
          {activities.fields.map((activity, index) => (
            <div className="assessment-editor" key={activity.form_key}>
              <Field label={`Учебная активность ${index + 1}`}>
                <input {...form.register(`activities.${index}.description`)} required />
              </Field>
              <Field label="Тема активности">
                <select {...form.register(`activities.${index}.topic_id`)}>
                  {snapshot.skeleton.topics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Controller
                control={form.control}
                name={`activities.${index}.outcome_ids`}
                render={({ field }) => (
                  <OutcomePicker
                    label="Осваиваемые результаты"
                    outcomes={currentOutcomes}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              <button
                type="button"
                className="link-button"
                onClick={() => activities.remove(index)}
              >
                Удалить активность {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              activities.append({
                id: `activity-${crypto.randomUUID()}`,
                topic_id: snapshot.skeleton.topics[0].id,
                outcome_ids: [currentOutcomes[0].id],
                description: '',
              })
            }
          >
            Добавить активность
          </button>
        </details>
        <Notice>
          Несходящиеся часы можно сохранить как диагностический черновик. Утверждение останется
          заблокированным до исправления. Пересчёт сохраняет заданные параметры.
        </Notice>
        <ErrorMessage error={command.error} />
        <div className="actions">
          <button type="submit" className="primary" disabled={command.isPending}>
            {command.isPending ? 'Сохраняем…' : 'Сохранить новую ревизию'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                !form.formState.isDirty ||
                window.confirm('Закрыть редактор? Несохранённый черновик останется в браузере.')
              )
                close();
            }}
          >
            Закрыть редактор
          </button>
          <BadgeDirty dirty={form.formState.isDirty} />
        </div>
      </Form>
    </Panel>
  );
}
function BadgeDirty({ dirty }: { dirty: boolean }) {
  return dirty ? <span className="muted">Есть несохранённые правки</span> : null;
}

function OutcomePicker({
  label,
  outcomes,
  value,
  onChange,
}: {
  label: string;
  outcomes: Skeleton['outcomes'];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="field outcome-picker-field">
      <span className="outcome-picker-label">{label}</span>
      <details className="outcome-picker" aria-label={label}>
        <summary>
          {value.length ? `Выбрано результатов: ${value.length}` : 'Выберите результаты'}
        </summary>
        <div className="outcome-picker-options">
          {outcomes.map((outcome, index) => (
            <label key={outcome.id}>
              <input
                type="checkbox"
                checked={value.includes(outcome.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, outcome.id]
                      : value.filter((id) => id !== outcome.id),
                  )
                }
              />
              <span>{outcome.description || `Результат ${index + 1}`}</span>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
