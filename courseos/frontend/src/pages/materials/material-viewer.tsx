import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Pencil, LockKeyhole } from 'lucide-react';
import type { Material, Snapshot } from '../../entities/course/model/schema';
import { useCommand } from '../../entities/course/api/provider';
import { materialLabels } from '../../entities/course/model/presets';
import { Badge, ErrorMessage, Field, Notice } from '../../shared/ui/ui';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';
export function MaterialViewer({
  material,
  snapshot,
  readonly,
}: {
  material: Material;
  snapshot: Snapshot;
  readonly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editVersion, setEditVersion] = useState(snapshot.course_version);
  const command = useCommand();
  const key = `courseos-material-draft-${snapshot.mode}-${snapshot.course_id}-${editVersion}-${material.id}`;
  const form = useForm<{ content: string }>({
    defaultValues: { content: localStorage.getItem(key) || material.content },
  });
  useUnsavedChanges(editing && form.formState.isDirty && !command.isSuccess);
  useEffect(() => {
    const subscription = form.watch((values) => {
      if (editing) localStorage.setItem(key, values.content || '');
    });
    return () => subscription.unsubscribe();
  }, [form, editing, key]);
  const versionParam = snapshot.course_version;
  return (
    <article className="material-viewer">
      <div className="toolbar">
        <Badge tone="green">{materialLabels[material.type]}</Badge>
        {material.manual && (
          <Badge>
            <LockKeyhole size={12} />
            Ручная правка защищена
          </Badge>
        )}
        <small>{material.id}</small>
        {!readonly && !material.stale && (
          <button
            className="link-button"
            onClick={() => {
              if (!editing) {
                setEditVersion(snapshot.course_version);
                form.reset({
                  content:
                    localStorage.getItem(
                      `courseos-material-draft-${snapshot.mode}-${snapshot.course_id}-${snapshot.course_version}-${material.id}`,
                    ) || material.content,
                });
              }
              setEditing(!editing);
            }}
          >
            <Pencil size={14} />
            Ручная правка
          </button>
        )}
      </div>
      <h2>{material.title}</h2>
      {material.stale && (
        <Notice tone="warning">
          Ожидает обновления после нового утверждения. Содержание относится к прежнему каркасу.
        </Notice>
      )}
      {editing && editVersion !== snapshot.course_version && (
        <Notice tone="warning">
          Версия изменилась в фоне. Ваш текст сохранён; применение к устаревшей версии будет
          отклонено.
        </Notice>
      )}
      {editing ? (
        <form
          onSubmit={form.handleSubmit(async (values) => {
            try {
              await command.mutateAsync({
                action: 'manual_material',
                expected_version: editVersion,
                payload: { material_id: material.id, content: values.content },
              });
              localStorage.removeItem(key);
              setEditing(false);
            } catch {
              /* Ручная правка остаётся в черновике до успешного сохранения. */
            }
          })}
        >
          <Field label="Содержание материала">
            <textarea {...form.register('content')} rows={8} required />
          </Field>
          <button className="primary" disabled={command.isPending}>
            Сохранить и защитить ручную правку
          </button>
          <ErrorMessage error={command.error} />
        </form>
      ) : (
        <pre className="material-content">{material.content}</pre>
      )}
      <div className="material-context">
        <div>
          <h4>Результаты обучения</h4>
          {material.outcome_ids.map((id) => (
            <Link key={id} to={`/courses/${snapshot.course_id}/map?version=${versionParam}#${id}`}>
              {snapshot.skeleton.outcomes.find((o) => o.id === id)?.description || id} ↗
            </Link>
          ))}
        </div>
        <div>
          <h4>Ожидаемый результат</h4>
          <p>{material.expected}</p>
          <h4>Критерии</h4>
          <ul>
            {material.criteria.map((criterion, index) => (
              <li key={index}>{criterion}</li>
            ))}
          </ul>
        </div>
      </div>
      {material.questions.length > 0 && (
        <div className="questions">
          <h3>{material.questions.length} вопросов с ключами и объяснениями</h3>
          {material.questions.map((question, index) => (
            <section className="question" key={question.id} id={question.id}>
              <div className="question-number">{String(index + 1).padStart(2, '0')}</div>
              <div>
                <h3>{question.text}</h3>
                <ol type="A">
                  {question.options.map((option, i) => (
                    <li className={i === question.correct_index ? 'correct-option' : ''} key={i}>
                      {option}
                      {i === question.correct_index && <Badge tone="green">Верный ответ</Badge>}
                    </li>
                  ))}
                </ol>
                <p>
                  <b>Объяснение:</b> {question.explanation}
                </p>
                <small>
                  {question.id} · {question.outcome_ids.join(', ')}
                </small>
              </div>
            </section>
          ))}
        </div>
      )}
      {material.slides.length > 0 && (
        <div className="slides">
          <h3>Содержание слайдов и пояснения преподавателя</h3>
          {material.slides.map((slide, index) => (
            <div className="slide" key={slide.id}>
              <span>
                СЛАЙД {index + 1} · {slide.id}
              </span>
              <h3>{slide.title}</h3>
              <ul>
                {slide.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
              <div className="slide-notes">
                <b>Пояснения преподавателя</b>
                <p>{slide.notes}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <details>
        <summary>Источники, замечания и контрольная сумма</summary>
        {material.source_ids.map((id) => (
          <Link key={id} to={`/courses/${snapshot.course_id}/map?version=${versionParam}#${id}`}>
            Открыть фрагмент {id} ↗
          </Link>
        ))}
        {!material.source_ids.length && (
          <p>Предметные источники не предоставлены; содержание демонстрационное.</p>
        )}
        {snapshot.audit.issues
          .filter((issue) => issue.element_id === material.id)
          .map((issue) => (
            <Notice key={issue.id} tone="warning">
              {issue.message} · {issue.suggested_fix}
            </Notice>
          ))}
        <code>SHA-256: {material.hash}</code>
      </details>
    </article>
  );
}
