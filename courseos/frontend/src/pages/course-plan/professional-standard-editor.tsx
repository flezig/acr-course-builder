import { useState } from 'react';
import { useCommand } from '../../entities/course/api/provider';
import {
  isProfessionalStandardReference,
  professionalStandards,
  professionalStandardReferences,
} from '../../entities/course/model/professional-standards';
import type { Requirements, Snapshot } from '../../entities/course/model/schema';
import { contentHash } from '../../shared/lib/decimal';
import { ErrorMessage, Field, Notice } from '../../shared/ui/ui';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';

export function ProfessionalStandardEditor({ snapshot }: { snapshot: Snapshot }) {
  const current = snapshot.skeleton.requirements.references.find(isProfessionalStandardReference);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(
    professionalStandards.find((standard) => standard.id === current?.id)?.scenario ||
      (current ? 'custom' : ''),
  );
  const [name, setName] = useState(current?.name || '');
  const [text, setText] = useState(current?.text || '');
  const [url, setUrl] = useState(current?.url || '');
  const [error, setError] = useState<unknown>(null);
  const command = useCommand();
  useUnsavedChanges(editing);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      let replacement: Requirements['references'] = [];
      if (selected === 'custom') {
        replacement = [
          {
            id: `professional-standard-custom-${crypto.randomUUID()}`,
            name: name.trim(),
            text: text.trim(),
            url: url.trim(),
            status: 'provided',
            coordinate: 'Текст профстандарта предоставлен методистом',
            claim: 'Применимость к результатам курса требует проверки',
            checked_at: '',
            scope:
              'Редакция и полнота текста не проверены. Содержимое ссылки автоматически не загружается.',
            hash: await contentHash({ text: text.trim(), url: url.trim() }),
          },
        ];
      } else if (selected) replacement = professionalStandardReferences(selected);
      await command.mutateAsync({
        action: 'save_skeleton',
        expected_version: snapshot.course_version,
        payload: {
          ...snapshot.skeleton,
          outcomes: snapshot.skeleton.outcomes.map((outcome) => ({
            ...outcome,
            professional_standard_code: null,
          })),
          requirements: {
            ...snapshot.skeleton.requirements,
            references: [
              ...snapshot.skeleton.requirements.references.filter(
                (reference) => !isProfessionalStandardReference(reference),
              ),
              ...replacement,
            ],
          },
        },
      });
      setEditing(false);
    } catch (error) {
      setError(error);
    }
  }

  if (!editing)
    return (
      <button type="button" onClick={() => setEditing(true)}>
        Изменить профстандарт
      </button>
    );
  const standard = professionalStandards.find((standard) => standard.scenario === selected);
  return (
    <form onSubmit={(event) => void save(event)}>
      <Field label="Профстандарт программы">
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          disabled={command.isPending}
        >
          <option value="">Без профстандарта</option>
          {professionalStandards.map((standard) => (
            <option key={standard.id} value={standard.scenario}>
              {standard.code} — {standard.title}
            </option>
          ))}
          <option value="custom">Свой профстандарт или другая редакция</option>
        </select>
      </Field>
      {standard && (
        <p>
          {standard.scope} Редакция: {standard.edition_date}.{' '}
          <a href={standard.source_url} target="_blank" rel="noreferrer">
            Источник Минтруда ↗
          </a>
        </p>
      )}
      {selected === 'custom' && (
        <>
          <Field label="Название и код профстандарта">
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Ссылка на профстандарт">
            <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} />
          </Field>
          <Field label="Текст профстандарта">
            <textarea
              required
              rows={8}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
        </>
      )}
      <Notice>
        Замена создаст новую ревизию. Связи результатов с прежним профстандартом будут сброшены;
        соответствие программы и актуальность документа нужно проверить заново.
      </Notice>
      <div className="actions">
        <button
          type="submit"
          disabled={command.isPending || (selected === 'custom' && (!name.trim() || !text.trim()))}
        >
          Сохранить профстандарт
        </button>
        <button
          type="button"
          disabled={command.isPending}
          onClick={() => {
            setSelected(
              professionalStandards.find((standard) => standard.id === current?.id)?.scenario ||
                (current ? 'custom' : ''),
            );
            setName(current?.name || '');
            setText(current?.text || '');
            setUrl(current?.url || '');
            setError(null);
            setEditing(false);
          }}
        >
          Отмена
        </button>
      </div>
      <ErrorMessage error={error} />
    </form>
  );
}
