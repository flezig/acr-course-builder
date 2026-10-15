import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GitCompareArrows, ArrowRight, ShieldCheck } from 'lucide-react';
import { useApi, useCommand } from '../../entities/course/api/provider';
import { useQuery } from '@tanstack/react-query';
import type { ChangeInput, ChangePlan, Snapshot } from '../../entities/course/model/schema';
import { Badge, ErrorMessage, Field, Notice, Panel } from '../../shared/ui/ui';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';
export function RevisionPanel({
  snapshot: currentSnapshot,
  readonly,
}: {
  snapshot: Snapshot;
  readonly: boolean;
}) {
  const [snapshot, setBaseSnapshot] = useState(currentSnapshot);
  const command = useCommand();
  const { api } = useApi();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [consent, setConsent] = useState(false);
  const [manualConsent, setManualConsent] = useState(false);
  const key = `courseos-change-draft-${snapshot.mode}-${snapshot.course_id}-${snapshot.course_version}`;
  const form = useForm<ChangeInput>({
    defaultValues: (() => {
      try {
        return (
          JSON.parse(localStorage.getItem(key) || 'null') || {
            type: 'question',
            target_id: snapshot.materials.flatMap((m) => m.questions)[0]?.id || '',
            request: '',
            replacement: '',
            correct_index: 0,
            explanation: '',
          }
        );
      } catch {
        return { type: 'question', target_id: '', request: '', replacement: '' };
      }
    })(),
  });
  const storedPlan = useQuery({
    queryKey: [api.mode, 'change', snapshot.course_id, search.get('change')],
    queryFn: () => api.getChange(snapshot.course_id, search.get('change')!),
    enabled: !!search.get('change'),
  });
  useEffect(() => {
    if (storedPlan.data) setPlan(storedPlan.data);
  }, [storedPlan.data]);
  useEffect(() => {
    const subscription = form.watch((values) => localStorage.setItem(key, JSON.stringify(values)));
    return () => subscription.unsubscribe();
  }, [form, key]);
  useUnsavedChanges(form.formState.isDirty && !plan);
  const type = form.watch('type');
  const questions = snapshot.materials.flatMap((m) => m.questions);
  const preview = form.handleSubmit(async (input) => {
    try {
      const result = await command.mutateAsync({
        action: 'change_preview',
        expected_version: snapshot.course_version,
        payload: input,
      });
      setPlan(result.change_plan);
      setConsent(false);
      const next = new URLSearchParams(search);
      next.set('change', result.change_plan!.id);
      setSearch(next, { replace: true });
    } catch {
      /* Предложение не применяется при ошибке preview. */
    }
  });
  const apply = async () => {
    if (!plan) return;
    try {
      await command.mutateAsync({
        action: 'change_apply',
        expected_version: snapshot.course_version,
        payload: { change_id: plan.id, overwrite_manual: manualConsent },
      });
      localStorage.removeItem(key);
      const next = new URLSearchParams(search);
      next.delete('change');
      setSearch(next, { replace: true });
      navigate(`/courses/${snapshot.course_id}/compare?before=${snapshot.course_version}`);
    } catch {
      /* Ошибка не теряет предложенную правку. */
    }
  };
  return (
    <Panel
      title="Согласованные правки программы"
      subtitle="Course Revision · сначала влияние и сравнение, затем ваше решение."
    >
      {currentSnapshot.course_version !== snapshot.course_version && (
        <Notice tone="warning">
          Версия изменилась; прежний черновик остаётся сохранённым.
          <button
            type="button"
            onClick={() => {
              setBaseSnapshot(currentSnapshot);
              setPlan(null);
              form.reset({
                type: 'question',
                target_id: currentSnapshot.materials.flatMap((m) => m.questions)[0]?.id || '',
                request: '',
                replacement: '',
                correct_index: 0,
                explanation: '',
              });
            }}
          >
            Начать новый план по актуальной версии
          </button>
        </Notice>
      )}
      {!plan ? (
        <form onSubmit={preview}>
          <div className="form-grid">
            <Field label="Что изменить">
              <select
                {...form.register('type')}
                disabled={readonly}
                onChange={(e) => {
                  form.setValue('type', e.target.value as ChangeInput['type']);
                  form.setValue(
                    'target_id',
                    e.target.value === 'question'
                      ? questions[0]?.id || ''
                      : e.target.value === 'topic'
                        ? snapshot.skeleton.topics[0].id
                        : 'project-final',
                  );
                }}
              >
                <option value="question">Вопрос теста</option>
                <option value="project">Требования к проекту</option>
                <option value="topic">Тему</option>
                <option value="hours">Объём часов</option>
                <option value="audience">Аудиторию</option>
              </select>
            </Field>
            {(type === 'question' || type === 'topic') && (
              <Field label="Элемент">
                <select {...form.register('target_id')} disabled={readonly}>
                  {(type === 'question'
                    ? questions.map((q) => ({ id: q.id, title: q.text }))
                    : snapshot.skeleton.topics.map((t) => ({ id: t.id, title: t.title }))
                  ).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id}: {item.title}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <Field label="Причина изменения">
            <input
              {...form.register('request')}
              required
              minLength={3}
              placeholder="Какое требование изменилось?"
              disabled={readonly}
            />
          </Field>
          <Field
            label={
              type === 'hours'
                ? 'Новый объём часов'
                : type === 'audience'
                  ? 'Новая аудитория'
                  : 'Предлагаемый текст'
            }
          >
            <textarea
              {...form.register('replacement')}
              required
              minLength={2}
              rows={3}
              disabled={readonly}
              placeholder={
                type === 'project'
                  ? 'Только текстовая игра без внешних API. Сохранить часы, переменные, условия и циклы.'
                  : 'Укажите конкретную новую формулировку'
              }
            />
          </Field>
          {type === 'question' && (
            <div className="form-grid">
              <Field label="Ключ (номер варианта, от 1)">
                <input
                  type="number"
                  min="1"
                  max={questions.find((q) => q.id === form.watch('target_id'))?.options.length || 3}
                  value={(form.watch('correct_index') ?? 0) + 1}
                  onChange={(e) =>
                    form.setValue('correct_index', Number(e.target.value) - 1, {
                      shouldDirty: true,
                    })
                  }
                  disabled={readonly}
                />
              </Field>
              <Field label="Объяснение ключа">
                <input {...form.register('explanation')} required disabled={readonly} />
              </Field>
            </div>
          )}
          <button
            className="primary"
            type="submit"
            disabled={readonly || command.isPending || !snapshot.approval_applicable}
          >
            <GitCompareArrows size={17} />
            Посмотреть влияние правки
          </button>
          <small className="muted">
            Стоимость неизвестна: usage и тариф backend не подключены.
          </small>
        </form>
      ) : (
        <div className="change-preview">
          <div className="toolbar">
            <Badge tone="green">Предложение · ещё не применено</Badge>
            <span>Базовая версия {plan.base_version}</span>
          </div>
          <h3>{plan.input.request}</h3>
          {plan.base_version !== snapshot.course_version && (
            <Notice tone="error">
              План устарел: текущая версия {snapshot.course_version}. Создайте новый preview.
            </Notice>
          )}
          <Notice tone={plan.requires_approval ? 'warning' : 'info'}>
            {plan.requires_approval
              ? 'Изменяется каркас. После применения нужно отдельно утвердить новую ревизию; до этого зависимые материалы не создаются.'
              : 'Каркас не меняется. Утверждение сохранится, если результаты, критерии и основания неизменны.'}
          </Notice>
          {plan.affected.map((element) => (
            <div className="diff-element" key={element.id}>
              <h3>
                {element.title} <small>{element.id}</small>
              </h3>
              <p>{element.reason}</p>
              <div className="diff-grid">
                <div>
                  <span>БЫЛО</span>
                  <pre>{element.before}</pre>
                </div>
                <div>
                  <span>ПРЕДЛАГАЕТСЯ</span>
                  <pre>{element.after}</pre>
                </div>
              </div>
              {element.manual && (
                <Notice tone="warning">Элемент содержит ручную правку. Она будет затронута.</Notice>
              )}
            </div>
          ))}
          {plan.input.type === 'question' && (
            <p>
              Предлагаемый ключ: {(plan.input.correct_index ?? 0) + 1}. Объяснение:{' '}
              {plan.input.explanation}
            </p>
          )}
          <details>
            <summary>
              <ShieldCheck size={16} /> Сохраняются {plan.preserved_ids.length} элементов
            </summary>
            <p>{plan.preserved_ids.join(', ')}</p>
            <p>После применения их содержание проверяется по ID и SHA-256.</p>
          </details>
          {plan.affected.some((e) => e.manual) && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={manualConsent}
                onChange={(e) => setManualConsent(e.target.checked)}
              />{' '}
              Отдельно разрешаю перезаписать указанные ручные правки
            </label>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{' '}
            Принимаю именно этот план изменений
          </label>
          <div className="actions">
            <button
              className="primary"
              disabled={
                !consent ||
                readonly ||
                command.isPending ||
                plan.base_version !== snapshot.course_version ||
                (plan.affected.some((e) => e.manual) && !manualConsent)
              }
              onClick={() => void apply()}
            >
              Применить согласованную правку
              <ArrowRight size={16} />
            </button>
            <button
              onClick={() => {
                setPlan(null);
                const next = new URLSearchParams(search);
                next.delete('change');
                setSearch(next, { replace: true });
              }}
            >
              Вернуться к предложению
            </button>
          </div>
        </div>
      )}
      <ErrorMessage error={command.error || storedPlan.error} />
    </Panel>
  );
}
