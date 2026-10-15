import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
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
import { materialLabels } from '../../entities/course/model/presets';
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
    if (focusTarget.startsWith('outcome-')) {
      const assessment = snapshot.skeleton.assessments.findIndex((item) =>
        item.outcome_ids.includes(focusTarget),
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
        {snapshot.skeleton.outcomes.map((outcome, index) => (
          <Field key={outcome.id} label={outcome.id}>
            <input {...form.register(`outcomes.${index}.description`)} required />
          </Field>
        ))}
        <div className="table-scroll">
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
                        aria-label={`Название ${topic.id}`}
                        {...form.register(`topics.${index}.title`)}
                        required
                      />
                    </Field>
                    <Field>
                      <textarea
                        aria-label={`Содержание ${topic.id}`}
                        {...form.register(`topics.${index}.content`)}
                        rows={2}
                      />
                    </Field>
                  </th>
                  {hourKinds.map((kind) => (
                    <td key={kind}>
                      <Field>
                        <input
                          className="hour-input"
                          aria-label={`${topic.id} ${hourLabels[kind]}`}
                          {...form.register(`topics.${index}.hours.${kind}`)}
                          inputMode="decimal"
                          required
                        />
                      </Field>
                    </td>
                  ))}
                  <td>
                    <Field>
                      <input
                        className="hour-input"
                        aria-label={`Заявленный объём ${topic.id}`}
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
          <summary>План оценивания и критерии</summary>
          {assessments.fields.map((assessment, index) => (
            <div key={assessment.form_key} className="assessment-editor">
              <strong>
                {assessment.id} · {assessment.type}
              </strong>
              <div className="form-grid">
                <Field label="Вид оценочного средства">
                  <select {...form.register(`assessments.${index}.type`)}>
                    {(['test', 'project', 'portfolio', 'exam', 'mentor_interview'] as const).map(
                      (type) => (
                        <option key={type} value={type}>
                          {materialLabels[type]}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <Field label="Проверяемые результаты (можно выбрать несколько)">
                  <select multiple {...form.register(`assessments.${index}.outcome_ids`)}>
                    {snapshot.skeleton.outcomes.map((outcome) => (
                      <option key={outcome.id} value={outcome.id}>
                        {outcome.description}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Наблюдаемое действие">
                <input {...form.register(`assessments.${index}.action`)} required />
              </Field>
              <Field label="Критерий">
                <input {...form.register(`assessments.${index}.criterion`)} required />
              </Field>
              <button
                type="button"
                className="link-button"
                onClick={() => assessments.remove(index)}
              >
                Удалить средство {assessment.id}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              assessments.append({
                id: `assessment-${crypto.randomUUID()}`,
                topic_id: 'topic-final',
                outcome_ids: [snapshot.skeleton.outcomes[0].id],
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
          {activities.fields.map((activity, index) => (
            <div className="assessment-editor" key={activity.form_key}>
              <Field label={`Описание ${activity.id}`}>
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
              <Field label="Осваиваемые результаты">
                <select multiple {...form.register(`activities.${index}.outcome_ids`)}>
                  {snapshot.skeleton.outcomes.map((outcome) => (
                    <option key={outcome.id} value={outcome.id}>
                      {outcome.description}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className="link-button"
                onClick={() => activities.remove(index)}
              >
                Удалить активность {activity.id}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              activities.append({
                id: `activity-${crypto.randomUUID()}`,
                topic_id: snapshot.skeleton.topics[0].id,
                outcome_ids: [snapshot.skeleton.outcomes[0].id],
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
