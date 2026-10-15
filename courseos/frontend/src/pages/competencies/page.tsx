import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { ResultsMap } from './results-map';
import type { Snapshot, Requirements } from '../../entities/course/model/schema';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';
import { ReferenceEditor } from '../../features/upload-reference/reference-editor';
import { useCommand, useCourse } from '../../entities/course/api/provider';
import {
  Form,
  Badge,
  Empty,
  ErrorMessage,
  Loading,
  Notice,
  Panel,
  statuses,
} from '../../shared/ui/ui';
export function MapPage() {
  const query = useCourse();
  const [search] = useSearchParams();
  if (query.isPending) return <Loading />;
  if (!query.data) return <ErrorMessage error={query.error} />;
  const snapshot = query.data.snapshot;
  if (!snapshot)
    return (
      <Empty title="Карта появится вместе с каркасом">
        Сначала завершите уточнение параметров.
      </Empty>
    );
  return (
    <>
      <ResultsMap
        key={`map-${snapshot.course_id}`}
        snapshot={snapshot}
        editable={query.data.is_latest && !['queued', 'running'].includes(query.data.job.status)}
        initialSearch={search.get('filter') || ''}
      />
      <Panel
        title="Источники и исходные фрагменты"
        subtitle="Наличие ссылки или текста не подтверждает достоверность и применимость."
      >
        {snapshot.sources.length === 0 && (
          <Notice tone="warning">
            Референсы не предоставлены. Нормативные и предметные утверждения остаются
            неподтверждёнными.
          </Notice>
        )}
        {snapshot.sources.map((source) => (
          <details key={source.id} className="source" id={source.id}>
            <summary>
              {source.name}
              <Badge>{statuses[source.status]}</Badge>
            </summary>
            <p>Поддерживаемое утверждение: {source.claim}</p>
            <p>
              {source.coordinate} · {new Date(source.checked_at).toLocaleDateString('ru-RU')} ·
              область: {source.scope}
            </p>
            <pre>{source.text || 'Содержимое ссылки не получено. Требуется backend.'}</pre>
            {source.url && (
              <a href={source.url} target="_blank" rel="noreferrer">
                Открыть исходный источник ↗
              </a>
            )}
            <code>SHA-256: {source.hash}</code>
          </details>
        ))}
      </Panel>
      {query.data.is_latest && !['queued', 'running'].includes(query.data.job.status) && (
        <CourseReferences key={`references-${snapshot.course_version}`} snapshot={snapshot} />
      )}
    </>
  );
}

function CourseReferences({ snapshot }: { snapshot: Snapshot }) {
  const [editing, setEditing] = useState(false);
  const command = useCommand();
  const key = `courseos-reference-draft-${snapshot.mode}-${snapshot.course_id}-${snapshot.course_version}`;
  const form = useForm<{ references: Requirements['references'] }>({
    mode: 'onChange',
    defaultValues: (() => {
      try {
        return JSON.parse(localStorage.getItem(key) || 'null') || { references: snapshot.sources };
      } catch {
        return { references: snapshot.sources };
      }
    })(),
  });
  useUnsavedChanges(editing && form.formState.isDirty && !command.isSuccess);
  useEffect(() => {
    const subscription = form.watch((values) => {
      if (editing) localStorage.setItem(key, JSON.stringify(values));
    });
    return () => subscription.unsubscribe();
  }, [form, editing, key]);
  return (
    <Panel title="Добавить основания к программе">
      {!editing ? (
        <button onClick={() => setEditing(true)}>Добавить текст, PDF, DOCX или ссылку</button>
      ) : (
        <Form
          errors={form.formState.errors}
          submitCount={form.formState.submitCount}
          onSubmit={form.handleSubmit(async (values) => {
            try {
              await command.mutateAsync({
                action: 'save_skeleton',
                expected_version: snapshot.course_version,
                payload: {
                  ...snapshot.skeleton,
                  requirements: {
                    ...snapshot.skeleton.requirements,
                    references: values.references,
                  },
                },
              });
              localStorage.removeItem(key);
              setEditing(false);
            } catch {
              /* Источники остаются в черновике до подтверждения сервером. */
            }
          })}
        >
          <ReferenceEditor
            courseId={snapshot.course_id}
            references={form.watch('references')}
            onChange={(references) =>
              form.setValue('references', references, { shouldDirty: true })
            }
          />
          <Notice>
            Изменение общих оснований создаёт новую ревизию каркаса. Материалы потребуют обновления
            после отдельного утверждения.
          </Notice>
          <button type="submit" className="primary" disabled={command.isPending}>
            Сохранить основания в новой ревизии
          </button>
          <ErrorMessage error={command.error} />
        </Form>
      )}
    </Panel>
  );
}
