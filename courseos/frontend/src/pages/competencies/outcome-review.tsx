import { useEffect, useRef, useState } from 'react';
import { Pencil, Sparkles, X } from 'lucide-react';
import type { Skeleton, Snapshot } from '../../entities/course/model/schema';
import { useCommand } from '../../entities/course/api/provider';
import { ErrorMessage, Form, Field } from '../../shared/ui/ui';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';
import { compactMapTitle } from './map-model';
import {
  isPlaceholderOutcome,
  outcomeCriteria,
  outcomeReviewSignature,
  outcomeReviewStatus,
} from './outcome-review-model';

type Props = {
  snapshot: Snapshot;
  id: string;
  editable: boolean;
  onSaved: (before: Skeleton, version: number) => void;
};
export function OutcomeReview({ snapshot, id, editable, onSaved }: Props) {
  const s = snapshot.skeleton;
  const outcome = s.outcomes.find((o) => o.id === id)!;
  const command = useCommand();
  const [aiOpen, setAiOpen] = useState(false);
  const [intent, setIntent] = useState('');
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [title, setTitle] = useState(outcome.title || compactMapTitle(outcome.description));
  const [description, setDescription] = useState(outcome.description);
  const [criteria, setCriteria] = useState(outcomeCriteria(s, id).join('\n'));
  const [depth, setDepth] = useState(outcome.depth);
  const dialog = useRef<HTMLDialogElement>(null);
  const draftKey = `courseos-outcome-draft:${snapshot.mode}:${snapshot.course_id}:${snapshot.course_version}:${id}`;
  useEffect(() => {
    if (!editing) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ title, description, criteria, depth }));
    } catch {
      /* Хранилище браузера необязательно для редактирования. */
    }
  }, [editing, draftKey, title, description, criteria, depth]);
  function discard() {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* Хранилище недоступно. */
    }
    setEditing(false);
  }
  useUnsavedChanges(
    editing &&
      (title !== (outcome.title || compactMapTitle(outcome.description)) ||
        description !== outcome.description ||
        criteria !== outcomeCriteria(s, id).join('\n') ||
        depth !== outcome.depth),
  );
  useEffect(() => {
    if (!editing) return;
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, [editing]);
  const updated = structuredClone(s);
  const next = updated.outcomes.find((o) => o.id === id)!;
  Object.assign(next, {
    title: title.trim(),
    description: description.trim(),
    criteria: criteria
      .split('\n')
      .map((c) => c.trim())
      .filter(Boolean),
    depth: depth.trim(),
    edited_by: 'human',
    review: undefined,
  });
  const changed =
    JSON.stringify({
      title: outcome.title || compactMapTitle(outcome.description),
      description: outcome.description,
      criteria: outcomeCriteria(s, id),
      depth: outcome.depth,
    }) !==
    JSON.stringify({
      title: next.title,
      description: next.description,
      criteria: next.criteria,
      depth: next.depth,
    });
  const assessments = s.assessments.filter((a) => a.outcome_ids.includes(id));
  const topics = s.topics.filter((t) => t.outcome_ids.includes(id));
  const activities = s.activities.filter((a) => a.outcome_ids.includes(id));
  const status = outcomeReviewStatus(s, id);
  const missing = isPlaceholderOutcome(outcome.description);
  const requirement = s.requirements[outcome.requirement_id as keyof typeof s.requirements];
  const hasRequirement =
    (typeof requirement === 'string' && !!requirement.trim()) ||
    s.requirements.references.some((r) => r.id === outcome.requirement_id);
  const reviewProblems = [
    missing &&
      'Укажите через «Редактировать», что учащийся сможет сделать после обучения: например, определить риск или обезличить данные.',
    !outcome.description.trim() &&
      'Формулировка результата отсутствует. Добавьте её через «Редактировать».',
    !outcomeCriteria(s, id).length &&
      'Критерии достижения не заданы. Добавьте их через «Редактировать».',
    !assessments.length && 'Нет связанного оценивания. Добавьте проверку в блоке оценивания ниже.',
    !topics.length &&
      !activities.length &&
      'Нет связанного обучения. Привяжите тему или практику ниже.',
    !hasRequirement && 'Нет исходного требования. Выберите его через «Изменить связи результата».',
  ].filter((problem): problem is string => !!problem);
  const validReview = reviewProblems.length === 0;
  async function save(payload: Skeleton) {
    try {
      await command.mutateAsync({
        action: 'save_skeleton',
        expected_version: snapshot.course_version,
        payload,
      });
      onSaved(s, snapshot.course_version + 1);
      discard();
    } catch {
      /* Ошибка показана рядом с действием; черновик сохраняется. */
    }
  }
  function edit() {
    setTitle(outcome.title || compactMapTitle(outcome.description));
    setDescription(outcome.description);
    setCriteria(outcomeCriteria(s, id).join('\n'));
    setDepth(outcome.depth);
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (
        draft &&
        ['title', 'description', 'criteria', 'depth'].every(
          (field) => typeof draft[field] === 'string',
        )
      ) {
        setTitle(draft.title);
        setDescription(draft.description);
        setCriteria(draft.criteria);
        setDepth(draft.depth);
      }
    } catch {
      /* При недоступном черновике открываем сохранённую версию. */
    }
    setPreview(false);
    setEditing(true);
  }
  return (
    <div className="result-formulation">
      <div className="outcome-origin">
        <span className="node-badge">
          {snapshot.mode === 'demo' ? 'Источник: демопример' : 'Создано ИИ'}
        </span>
        {outcome.edited_by && <span>Изменено вручную</span>}
        <span className={`review-state ${status === 'Проверен' ? 'checked' : ''}`}>{status}</span>
      </div>
      <h2>{outcome.title || compactMapTitle(outcome.description)}</h2>
      <p className="column-caption">Наблюдаемое действие учащегося</p>
      <p className="full-outcome-text">
        {missing
          ? 'Наблюдаемое действие не задано: указано только название темы, без описания того, что учащийся сможет сделать после обучения.'
          : outcome.description}
      </p>
      <div className="outcome-actions">
        {editable && (
          <button className="map-inline-action" onClick={edit}>
            <Pencil size={14} />
            Редактировать
          </button>
        )}
        <button
          className="map-inline-action"
          aria-expanded={aiOpen}
          onClick={() => setAiOpen(!aiOpen)}
        >
          <Sparkles size={14} />
          Уточнить с ИИ
        </button>
      </div>
      {aiOpen && (
        <div className="outcome-ai-panel">
          <p>
            <strong>ИИ-уточнение не подключено.</strong> Автоматические предложения недоступны.
            Можно подготовить черновик вручную и проверить его перед применением.
          </p>
          <div className="outcome-actions">
            {['Сделать формулировку измеримой', 'Изменить сложность', 'Предложить оценивание'].map(
              (action) => (
                <button
                  key={action}
                  aria-pressed={intent === action}
                  onClick={() => setIntent(action)}
                >
                  {action}
                </button>
              ),
            )}
          </div>
          {intent && (
            <p role="status">
              {intent}: требуется подключение ИИ.
              {intent === 'Предложить оценивание' &&
                ' Существующее оценивание можно изменить в редакторе программы.'}
            </p>
          )}
          {editable && <button onClick={edit}>Подготовить предложение вручную</button>}
        </div>
      )}
      <details className="outcome-criteria">
        <summary>Критерии достижения · {outcomeCriteria(s, id).length}</summary>
        {outcomeCriteria(s, id).length ? (
          <>
            <p className="column-caption">
              {outcome.criteria
                ? 'Критерии результата, введённые вручную.'
                : 'Критерии из связанного оценивания — черновик для проверки.'}
            </p>
            <ul>
              {outcomeCriteria(s, id).map((criterion, i) => (
                <li key={i}>{criterion}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            Критерии не заданы.{' '}
            {editable && (
              <button className="map-inline-action" onClick={edit}>
                Добавить критерии
              </button>
            )}
          </p>
        )}
        <details>
          <summary>Исходная формулировка</summary>
          <p>{outcome.description}</p>
          <p>{outcome.depth}</p>
        </details>
      </details>
      {editable && status !== 'Проверен' && (
        <div className="outcome-check">
          {validReview ? (
            <p>
              Подтвердите после проверки формулировки, критериев, требований и связанного
              оценивания.
            </p>
          ) : (
            <ul className="review-problems">
              {reviewProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          <button
            disabled={!validReview || command.isPending}
            onClick={() => {
              const checked = structuredClone(s);
              checked.outcomes.find((o) => o.id === id)!.review = {
                signature: outcomeReviewSignature(s, id),
                checked_at: new Date().toISOString(),
              };
              void save(checked);
            }}
          >
            Подтвердить проверку результата
          </button>
        </div>
      )}
      {status === 'Проверен' && (
        <p className="column-caption">
          Проверено пользователем {new Date(outcome.review!.checked_at).toLocaleDateString('ru-RU')}
          . При изменении содержания или связей потребуется повторная проверка.
        </p>
      )}
      {!editing && <ErrorMessage error={command.error} />}
      {editing && (
        <dialog
          ref={dialog}
          className="map-link-dialog outcome-edit-dialog"
          aria-labelledby="outcome-edit-title"
          onCancel={(e) => {
            e.preventDefault();
            if (!command.isPending) discard();
          }}
        >
          <div className="details-topline">
            <span>Черновик для проверки</span>
            <button
              aria-label="Закрыть редактирование"
              disabled={command.isPending}
              onClick={discard}
            >
              <X size={18} />
            </button>
          </div>
          <h2 id="outcome-edit-title">
            {preview ? 'Просмотр изменений' : 'Редактировать результат'}
          </h2>
          {!preview ? (
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                setPreview(true);
              }}
            >
              <Field label="Короткое название">
                <input required value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Наблюдаемое действие учащегося">
                <textarea
                  required
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field label="Критерии достижения — по одному на строку">
                <textarea rows={4} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
              </Field>
              <Field label="Сложность и условия выполнения">
                <textarea rows={2} value={depth} onChange={(e) => setDepth(e.target.value)} />
              </Field>
              <p>
                Новые формулировки — предложения автора правки. Они требуют проверки и не добавляют
                исходных требований.
              </p>
              <div className="map-link-actions">
                <button type="button" onClick={discard}>
                  Отклонить
                </button>
                <button
                  className="primary"
                  disabled={!changed || !title.trim() || !description.trim()}
                >
                  Просмотреть изменения
                </button>
              </div>
            </Form>
          ) : (
            <>
              <div className="outcome-comparison">
                {[
                  { label: 'Текущая версия', item: outcome, criteria: outcomeCriteria(s, id) },
                  {
                    label: 'Предложенная версия · вручную',
                    item: next,
                    criteria: next.criteria || [],
                  },
                ].map((version) => (
                  <section key={version.label}>
                    <h3>{version.label}</h3>
                    <strong>
                      {version.item.title || compactMapTitle(version.item.description)}
                    </strong>
                    <p>{version.item.description}</p>
                    <h4>Критерии</h4>
                    {version.criteria.length ? (
                      <ul>
                        {version.criteria.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Не заданы</p>
                    )}
                    <p>{version.item.depth}</p>
                  </section>
                ))}
              </div>
              <h3>Затрагиваемые связи</h3>
              <p>Исходное требование: {outcome.requirement_id || 'не связано'}.</p>
              <p>
                Связи сохранятся. Связанные задания и критерии оценивания автоматически не меняются.
                Проверьте соответствие новой формулировке:
              </p>
              <ul>
                {[
                  ...topics.map((t) => `Тема: ${t.title}`),
                  ...activities.map((a) => `Практика: ${a.description}`),
                  ...assessments.map((a) => `Оценивание: ${a.action}`),
                ].map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
              {!topics.length && !activities.length && !assessments.length && (
                <p>Связей с обучением и оцениванием нет.</p>
              )}
              <p>
                Сохранение создаст новую ревизию. Проверка результата и утверждение программы
                потребуют повторного подтверждения.
              </p>
              <ErrorMessage error={command.error} />
              <div className="map-link-actions">
                <button disabled={command.isPending} onClick={() => setPreview(false)}>
                  Вернуться к правке
                </button>
                <button disabled={command.isPending} onClick={discard}>
                  Отклонить
                </button>
                <button
                  className="primary"
                  disabled={command.isPending || !editable}
                  onClick={() => void save(updated)}
                >
                  {command.isPending ? 'Применяем…' : 'Применить'}
                </button>
              </div>
            </>
          )}
        </dialog>
      )}
    </div>
  );
}
