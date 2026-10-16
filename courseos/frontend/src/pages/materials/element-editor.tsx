import { useEffect, useState } from 'react';
import type {
  ChangeInput,
  ChangePlan,
  Material,
  Snapshot,
} from '../../entities/course/model/schema';
import { changeInputSchema } from '../../entities/course/model/schema';
import { useCommand } from '../../entities/course/api/provider';
import { ErrorMessage, Field, Notice } from '../../shared/ui/ui';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';

function readable(value: string): string {
  try {
    const object = JSON.parse(value) as Record<string, unknown>;
    const labels: Record<string, string> = {
      id: 'Элемент',
      text: 'Вопрос',
      options: 'Варианты',
      correct_index: 'Верный вариант',
      explanation: 'Объяснение',
      outcome_ids: 'Результаты',
      title: 'Заголовок',
      bullets: 'Содержание',
      notes: 'Заметки преподавателя',
      content: 'Условия',
      expected: 'Ожидаемый результат',
      criteria: 'Критерии',
    };
    return Object.entries(object)
      .map(
        ([key, item]) =>
          `${labels[key] || key}: ${key === 'correct_index' ? Number(item) + 1 : Array.isArray(item) ? item.join('\n') : item}`,
      )
      .join('\n');
  } catch {
    return value;
  }
}
export function ElementEditor({
  material,
  snapshot,
  type,
  targetId,
}: {
  material: Material;
  snapshot: Snapshot;
  type: 'question' | 'slide' | 'assignment' | 'material';
  targetId: string;
}) {
  const command = useCommand();
  const [open, setOpen] = useState(false);
  const [baseVersion, setBaseVersion] = useState(snapshot.course_version);
  const [input, setInput] = useState<ChangeInput | null>(null);
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [error, setError] = useState<unknown>();
  const storageKey = `courseos-material-draft-${snapshot.mode}-${snapshot.course_id}-${baseVersion}-${targetId}`;
  useUnsavedChanges(open);
  useEffect(() => {
    if (open && input) localStorage.setItem(storageKey, JSON.stringify(input));
  }, [open, input, storageKey]);
  const begin = () => {
    setBaseVersion(snapshot.course_version);
    const question = material.questions.find((q) => q.id === targetId);
    const slide = material.slides.find((s) => s.id === targetId);
    const initial: ChangeInput = {
      type,
      target_id: targetId,
      request: 'Ручное исправление выбранного элемента',
      manual: true,
      replacement: question?.text || slide?.title || material.content,
      ...(question
        ? {
            options: question.options,
            correct_index: question.correct_index,
            explanation: question.explanation,
            outcome_ids: question.outcome_ids,
          }
        : {}),
      ...(slide
        ? { slide: { title: slide.title, bullets: slide.bullets, notes: slide.notes } }
        : {}),
      ...(!question && !slide ? { expected: material.expected, criteria: material.criteria } : {}),
    };
    try {
      const saved = JSON.parse(
        localStorage.getItem(
          `courseos-material-draft-${snapshot.mode}-${snapshot.course_id}-${snapshot.course_version}-${targetId}`,
        ) || 'null',
      );
      setInput(changeInputSchema.safeParse(saved).success ? saved : initial);
    } catch {
      setInput(initial);
    }
    setOpen(true);
    setPlan(null);
    setError(null);
  };
  const update = (patch: Partial<ChangeInput>) => {
    setInput((current) => ({ ...current!, ...patch }));
    setPlan(null);
  };
  const labels = {
    question: 'Редактировать вопрос',
    slide: 'Редактировать слайд',
    assignment: 'Редактировать задание',
    material: 'Ручная правка',
  };
  if (!open || !input)
    return (
      <button type="button" className="link-button" onClick={begin}>
        {labels[type]}
      </button>
    );
  return (
    <section className="element-editor" aria-label={labels[type]}>
      <h3>{labels[type]}</h3>
      {snapshot.course_version !== baseVersion && (
        <Notice tone="warning">
          Версия изменилась. Черновик сохранён; применение к старой версии будет отклонено.
        </Notice>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          try {
            const parsed = changeInputSchema.parse(input);
            const result = await command.mutateAsync({
              action: 'change_preview',
              expected_version: baseVersion,
              payload: parsed,
            });
            setPlan(result.change_plan);
          } catch (failure) {
            setError(failure);
          }
        }}
      >
        {type === 'question' ? (
          <>
            <Field label="Формулировка вопроса">
              <textarea
                value={input.replacement}
                onChange={(e) => update({ replacement: e.target.value })}
                required
              />
            </Field>
            <Field label="Варианты ответа — каждый с новой строки">
              <textarea
                value={input.options?.join('\n')}
                onChange={(e) => update({ options: e.target.value.split('\n') })}
                required
              />
            </Field>
            <Field label="Номер верного ответа">
              <input
                type="number"
                min="1"
                max={input.options?.length}
                value={(input.correct_index ?? 0) + 1}
                onChange={(e) => update({ correct_index: Number(e.target.value) - 1 })}
                required
              />
            </Field>
            <Field label="Объяснение ответа">
              <textarea
                value={input.explanation}
                onChange={(e) => update({ explanation: e.target.value })}
                required
              />
            </Field>
            <fieldset>
              <legend>Связи с результатами обучения</legend>
              {snapshot.skeleton.outcomes.map((outcome) => (
                <label className="checkbox" key={outcome.id}>
                  <input
                    type="checkbox"
                    checked={input.outcome_ids?.includes(outcome.id) || false}
                    onChange={(e) =>
                      update({
                        outcome_ids: e.target.checked
                          ? [...(input.outcome_ids || []), outcome.id]
                          : input.outcome_ids?.filter((id) => id !== outcome.id),
                      })
                    }
                  />
                  {outcome.title || outcome.description}
                </label>
              ))}
            </fieldset>
          </>
        ) : type === 'slide' ? (
          <>
            <Field label="Заголовок слайда">
              <input
                value={input.slide?.title}
                onChange={(e) =>
                  update({
                    replacement: e.target.value,
                    slide: { ...input.slide!, title: e.target.value },
                  })
                }
                required
              />
            </Field>
            <Field label="Содержание слайда — каждый пункт с новой строки">
              <textarea
                value={input.slide?.bullets.join('\n')}
                onChange={(e) =>
                  update({ slide: { ...input.slide!, bullets: e.target.value.split('\n') } })
                }
                required
              />
            </Field>
            <Field label="Заметки преподавателя">
              <textarea
                value={input.slide?.notes}
                onChange={(e) => update({ slide: { ...input.slide!, notes: e.target.value } })}
                required
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={type === 'assignment' ? 'Условия задания' : 'Содержание материала'}>
              <textarea
                rows={7}
                value={input.replacement}
                onChange={(e) => update({ replacement: e.target.value })}
                required
              />
            </Field>
            <Field label="Ожидаемый результат">
              <textarea
                value={input.expected}
                onChange={(e) => update({ expected: e.target.value })}
                required
              />
            </Field>
            <Field label="Критерии — каждый с новой строки">
              <textarea
                value={input.criteria?.join('\n')}
                onChange={(e) => update({ criteria: e.target.value.split('\n') })}
                required
              />
            </Field>
          </>
        )}
        <Field label="Причина изменения">
          <input
            value={input.request}
            onChange={(e) => update({ request: e.target.value })}
            minLength={3}
            required
          />
        </Field>
        <button type="submit" disabled={command.isPending}>
          Посмотреть изменения и зависимости
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Закрыть редактор
        </button>
      </form>
      {plan && (
        <section className="edit-preview" aria-label="Предпросмотр правки">
          <h4>Что изменится</h4>
          {plan.affected.map((item) => (
            <div key={item.id}>
              <p>
                <b>{item.title}</b>
              </p>
              <p>{item.reason}</p>
              <details>
                <summary>До изменения</summary>
                <pre className="material-content">{readable(item.before)}</pre>
              </details>
              <pre className="material-content">{readable(item.after)}</pre>
            </div>
          ))}
          <Notice>
            {plan.requires_approval
              ? 'Меняются требования оценивания или связи с результатами. Потребуется повторное утверждение структуры программы.'
              : 'Основа программы сохраняется. Повторное утверждение структуры программы не требуется; правка записывается в новую версию.'}{' '}
            Другие материалы и их ручные правки сохраняются. Этот элемент будет защищён как ручная
            правка.
          </Notice>
          <button
            type="button"
            className="primary"
            disabled={command.isPending}
            onClick={async () => {
              try {
                await command.mutateAsync({
                  action: 'change_apply',
                  expected_version: baseVersion,
                  payload: { change_id: plan.id, overwrite_manual: true },
                });
                localStorage.removeItem(storageKey);
                setOpen(false);
                setPlan(null);
              } catch (failure) {
                setError(failure);
              }
            }}
          >
            Применить правку и сохранить версию
          </button>
        </section>
      )}
      <ErrorMessage error={error || command.error} />
    </section>
  );
}
