import { useState } from 'react';
import { useCommand } from '../../entities/course/api/provider';
import { isProfessionalStandardReference } from '../../entities/course/model/professional-standards';
import type { Snapshot } from '../../entities/course/model/schema';
import { contentHash } from '../../shared/lib/decimal';
import { ErrorMessage, Form, Notice } from '../../shared/ui/ui';
import { ProfessionalStandardFields } from '../../features/professional-standard/professional-standard-fields';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';

export function ProfessionalStandardEditor({ snapshot }: { snapshot: Snapshot }) {
  const current = snapshot.skeleton.requirements.references.find(isProfessionalStandardReference);
  const [editing, setEditing] = useState(false);
  const [reference, setReference] = useState(current);
  const [error, setError] = useState<unknown>(null);
  const command = useCommand();
  useUnsavedChanges(editing);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const replacement = reference
        ? [
            {
              ...reference,
              hash:
                reference.hash ||
                (await contentHash({ text: reference.text, url: reference.url.trim() })),
              url: reference.url.trim(),
            },
          ]
        : [];
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
  return (
    <Form onSubmit={(event) => void save(event)}>
      <ProfessionalStandardFields
        reference={reference}
        onChange={setReference}
        disabled={command.isPending}
      />
      <Notice>
        Замена создаст новую ревизию. Связи результатов с прежним профстандартом будут сброшены;
        соответствие программы и актуальность документа нужно проверить заново.
      </Notice>
      <div className="actions">
        <button
          type="submit"
          disabled={
            command.isPending || (!!reference && (!reference.name.trim() || !reference.text.trim()))
          }
        >
          Сохранить профстандарт
        </button>
        <button
          type="button"
          disabled={command.isPending}
          onClick={() => {
            setReference(current);
            setError(null);
            setEditing(false);
          }}
        >
          Отмена
        </button>
      </div>
      <ErrorMessage error={error} />
    </Form>
  );
}
