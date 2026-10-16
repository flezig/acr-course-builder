import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import type { Skeleton, Snapshot } from '../../entities/course/model/schema';
import { useCommand } from '../../entities/course/api/provider';
import { Form, ErrorMessage, Field } from '../../shared/ui/ui';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';

export type IntentBlock = 'goal' | 'audience' | 'outcomes' | 'tasks';
type Values = {
  goal: string;
  audience: string;
  entry_level: string;
  outcomes: Skeleton['outcomes'];
  tasks: { description: string }[];
};
export function IntentBlockEditor({
  snapshot: currentSnapshot,
  block,
  close,
  saved,
  focusOutcome,
}: {
  snapshot: Snapshot;
  block: IntentBlock;
  close: () => void;
  saved: () => void;
  focusOutcome?: string;
}) {
  // Сохраняем исходную версию, чтобы не перезаписать параллельные изменения.
  const [snapshot] = useState(currentSnapshot);
  const key = `courseos-intent-draft-${snapshot.mode}-${snapshot.course_id}-${snapshot.course_version}-${block}`;
  const [draftError, setDraftError] = useState('');
  const command = useCommand();
  const form = useForm<Values>({
    mode: 'onChange',
    defaultValues: (() => {
      try {
        const draft = localStorage.getItem(key);
        if (draft) {
          const values = JSON.parse(draft);
          return {
            ...values,
            outcomes: values.outcomes.map(
              (outcome: { id?: string; description: string }, index: number) =>
                outcome.id ? outcome : { ...snapshot.skeleton.outcomes[index], ...outcome },
            ),
            tasks: values.tasks || snapshot.skeleton.tasks.map((description) => ({ description })),
          };
        }
      } catch {
        /* Use the saved programme. */
      }
      return {
        goal: snapshot.skeleton.goal,
        audience: snapshot.skeleton.requirements.audience,
        entry_level: snapshot.skeleton.requirements.entry_level,
        outcomes: snapshot.skeleton.outcomes,
        tasks: snapshot.skeleton.tasks.map((description) => ({ description })),
      };
    })(),
  });
  const outcomes = useFieldArray({ control: form.control, name: 'outcomes', keyName: 'form_key' });
  const tasks = useFieldArray({ control: form.control, name: 'tasks' });
  useUnsavedChanges(form.formState.isDirty && !command.isSuccess);
  useEffect(() => {
    const subscription = form.watch((values) => {
      try {
        localStorage.setItem(key, JSON.stringify(values));
      } catch {
        setDraftError(
          'Не удалось сохранить черновик в браузере. Оставьте редактор открытым до сохранения.',
        );
      }
    });
    return () => subscription.unsubscribe();
  }, [form, key]);
  useEffect(() => {
    const index = snapshot.skeleton.outcomes.findIndex((outcome) => outcome.id === focusOutcome);
    form.setFocus(
      block === 'goal'
        ? 'goal'
        : block === 'audience'
          ? 'audience'
          : block === 'tasks'
            ? 'tasks.0.description'
            : `outcomes.${Math.max(0, index)}.description`,
    );
  }, [block, form, snapshot, focusOutcome]);
  return (
    <Form
      errors={form.formState.errors}
      submitCount={form.formState.submitCount}
      className="intent-editor"
      onSubmit={form.handleSubmit(async (values) => {
        const skeleton = snapshot.skeleton;
        const outcomeIds = new Set(values.outcomes.map((outcome) => outcome.id));
        const payload = {
          ...skeleton,
          goal: block === 'goal' ? values.goal.trim() : skeleton.goal,
          requirements:
            block === 'audience'
              ? {
                  ...skeleton.requirements,
                  audience: values.audience.trim(),
                  entry_level: values.entry_level.trim(),
                }
              : skeleton.requirements,
          outcomes:
            block === 'outcomes'
              ? values.outcomes.map((outcome) => ({
                  ...outcome,
                  description: outcome.description.trim(),
                }))
              : skeleton.outcomes,
          tasks:
            block === 'tasks'
              ? values.tasks.map((task) => task.description.trim())
              : skeleton.tasks,
          ...(block === 'outcomes'
            ? {
                topics: skeleton.topics.map((topic) => ({
                  ...topic,
                  outcome_ids: topic.outcome_ids.filter((id) => outcomeIds.has(id)),
                })),
                activities: skeleton.activities.map((activity) => ({
                  ...activity,
                  outcome_ids: activity.outcome_ids.filter((id) => outcomeIds.has(id)),
                })),
                assessments: skeleton.assessments.map((assessment) => ({
                  ...assessment,
                  outcome_ids: assessment.outcome_ids.filter((id) => outcomeIds.has(id)),
                })),
              }
            : {}),
        };
        try {
          await command.mutateAsync({
            action: 'save_skeleton',
            expected_version: snapshot.course_version,
            payload,
          });
          try {
            localStorage.removeItem(key);
          } catch {
            /* The programme has already been saved. */
          }
          saved();
        } catch {
          /* Keep all entered values on error, including a version conflict. */
        }
      })}
    >
      {block === 'goal' && (
        <Field label="Цель обучения">
          <textarea
            {...form.register('goal', {
              validate: (value) => !!value.trim() || 'Заполните это поле.',
            })}
            required
            rows={3}
          />
        </Field>
      )}
      {block === 'audience' && (
        <div className="form-grid">
          <Field label="Аудитория">
            <input
              {...form.register('audience', {
                validate: (value) => !!value.trim() || 'Заполните это поле.',
              })}
              required
            />
          </Field>
          <Field label="Входной уровень">
            <input
              {...form.register('entry_level', {
                validate: (value) => !!value.trim() || 'Заполните это поле.',
              })}
              required
            />
          </Field>
        </div>
      )}
      {block === 'outcomes' && (
        <>
          {outcomes.fields.map((outcome, index) => (
            <div key={outcome.form_key}>
              <Field key={outcome.id} label={`Результат ${index + 1}`}>
                <textarea
                  className={outcome.id === focusOutcome ? 'field-highlight' : ''}
                  {...form.register(`outcomes.${index}.description`, {
                    validate: (value) => !!value.trim() || 'Заполните это поле.',
                  })}
                  required
                  rows={2}
                />
              </Field>
              <button type="button" className="link-button" onClick={() => outcomes.remove(index)}>
                Удалить результат {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              outcomes.append({
                id: `outcome-${crypto.randomUUID()}`,
                description: '',
                kind: 'skill',
                requirement_id: 'request',
                prerequisite: snapshot.skeleton.requirements.entry_level,
                depth: '',
                professional_standard_code: null,
              })
            }
          >
            Добавить результат обучения
          </button>
        </>
      )}
      {block === 'tasks' && (
        <>
          {tasks.fields.map((task, index) => (
            <div key={task.id}>
              <Field label={`Задача ${index + 1}`}>
                <textarea
                  {...form.register(`tasks.${index}.description`, {
                    validate: (value) => !!value.trim() || 'Заполните это поле.',
                  })}
                  required
                  rows={2}
                />
              </Field>
              <button type="button" className="link-button" onClick={() => tasks.remove(index)}>
                Удалить задачу {index + 1}
              </button>
            </div>
          ))}
          <button type="button" onClick={() => tasks.append({ description: '' })}>
            Добавить задачу
          </button>
        </>
      )}
      <ErrorMessage error={command.error} />
      {draftError && <p role="alert">{draftError}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={command.isPending}>
          {command.isPending ? 'Сохраняем…' : 'Сохранить изменения'}
        </button>
        <button type="button" disabled={command.isPending} onClick={close}>
          Закрыть
        </button>
        <small>
          {form.formState.isDirty
            ? 'Есть несохранённые изменения'
            : 'Изменения создадут новую версию'}
        </small>
      </div>
      <small className="muted">
        Черновик сохраняется в этом браузере. Утверждение выполняется отдельно.
      </small>
    </Form>
  );
}
