import type { Requirements } from '../../entities/course/model/schema';
import { isProfessionalStandardReference } from '../../entities/course/model/professional-standards';
import {
  referenceUrlError,
  userReference,
  type Reference,
} from '../../entities/course/model/user-reference';
import { ReferenceEditor } from '../../features/upload-reference/reference-editor';
import { Field } from '../../shared/ui/ui';

export function CreateReferences({
  references,
  onChange,
}: {
  references: Requirements['references'];
  onChange: (references: Requirements['references']) => void;
}) {
  const materials = references.filter((reference) => !isProfessionalStandardReference(reference));
  const replace = (current: Reference | undefined, replacement: Reference) =>
    onChange(
      current
        ? references.map((reference) => (reference.id === current.id ? replacement : reference))
        : [...references, replacement],
    );
  const remove = (source: Reference) =>
    onChange(references.filter((reference) => reference.id !== source.id));
  const update = (source: Reference | undefined, patch: Pick<Reference, 'url'>) => {
    replace(
      source,
      userReference({
        id: source?.id || `useful-link-${crypto.randomUUID()}`,
        name: '',
        ...source,
        ...patch,
      }),
    );
  };
  return (
    <section className="create-references" aria-label="Материалы для программы">
      {(materials.length ? materials : [undefined]).map((source, index) => (
        <div className="create-reference" key={index}>
          {source?.text && <p className="create-reference-saved">{source.name} · текст сохранён</p>}
          <Field
            label="Ссылка на материал"
            hint="Прошлая программа или другой материал. Необязательно; содержимое ссылки не загружается."
            error={referenceUrlError(source?.url || '')}
          >
            <input
              type="url"
              required={!!source && !source.text.trim()}
              value={source?.url || ''}
              placeholder="https://…"
              onChange={(event) => update(source, { url: event.target.value })}
            />
          </Field>
          {source && (
            <button type="button" className="link-button" onClick={() => remove(source)}>
              Убрать ссылку
            </button>
          )}
        </div>
      ))}
      {!!materials.length && (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...references,
              userReference({ id: `useful-link-${crypto.randomUUID()}`, name: '' }),
            ])
          }
        >
          Добавить ещё ссылку
        </button>
      )}
      <ReferenceEditor uploadOnly references={references} onChange={onChange} />
    </section>
  );
}
