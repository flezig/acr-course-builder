import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { Snapshot } from '../../entities/course/model/schema';
import { useCommand } from '../../entities/course/api/provider';
import { Form, ErrorMessage, Field } from '../../shared/ui/ui';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';

export type IntentBlock = 'goal' | 'audience' | 'outcomes';
type Values = {
  goal: string;
  audience: string;
  entry_level: string;
  outcomes: { description: string }[];
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
  // Keep the version on which editing began so concurrent changes cannot be overwritten.
  const [snapshot] = useState(currentSnapshot);
  const key = `courseos-intent-draft-${snapshot.mode}-${snapshot.course_id}-${snapshot.course_version}-${block}`;
  const [draftError, setDraftError] = useState('');
  const command = useCommand();
  const form = useForm<Values>({
    mode: 'onChange',
    defaultValues: (() => {
      try {
        const draft = localStorage.getItem(key);
        if (draft) return JSON.parse(draft);
      } catch {
        /* Use the saved programme. */
      }
      return {
        goal: snapshot.skeleton.goal,
        audience: snapshot.skeleton.requirements.audience,
        entry_level: snapshot.skeleton.requirements.entry_level,
        outcomes: snapshot.skeleton.outcomes.map((outcome) => ({
          description: outcome.description,
        })),
      };
    })(),
  });
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
              ? skeleton.outcomes.map((outcome, index) => ({
                  ...outcome,
                  description: values.outcomes[index].description.trim(),
                }))
              : skeleton.outcomes,
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
      {block === 'outcomes' &&
        snapshot.skeleton.outcomes.map((outcome, index) => (
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
        ))}
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
            : 'Изменения создадут новую ревизию'}
        </small>
      </div>
      <small className="muted">
        Черновик сохраняется в этом браузере. Утверждение выполняется отдельно.
      </small>
    </Form>
  );
}
