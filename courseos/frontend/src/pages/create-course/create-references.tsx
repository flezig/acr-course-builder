import type { Requirements } from '../../entities/course/model/schema';
import { isProfessionalStandardReference } from '../../entities/course/model/professional-standards';
import {
  referenceUrlError,
  userReference,
  type Reference,
} from '../../entities/course/model/user-reference';
import { ReferenceEditor } from '../../features/upload-reference/reference-editor';
import { Field } from '../../shared/ui/ui';

const isPreviousProgram = (reference: Reference) =>
  !isProfessionalStandardReference(reference) &&
  !reference.id.startsWith('useful-link-') &&
  (!!reference.text || !reference.url || reference.id.startsWith('previous-program-'));

export function CreateReferences({
  references,
  onChange,
}: {
  references: Requirements['references'];
  onChange: (references: Requirements['references']) => void;
}) {
  const previousPrograms = references.filter(isPreviousProgram);
  const links = references.filter(
    (reference) => !isProfessionalStandardReference(reference) && !isPreviousProgram(reference),
  );
  const replace = (current: Reference | undefined, replacement: Reference) =>
    onChange(
      current
        ? references.map((reference) => (reference.id === current.id ? replacement : reference))
        : [...references, replacement],
    );
  const remove = (source: Reference) =>
    onChange(references.filter((reference) => reference.id !== source.id));
  const update = (
    source: Reference | undefined,
    patch: Partial<Pick<Reference, 'name' | 'text' | 'url'>>,
    previous: boolean,
  ) => {
    replace(
      source,
      userReference({
        id:
          source?.id || `${previous ? 'previous-program-' : 'useful-link-'}${crypto.randomUUID()}`,
        name: previous ? 'Прошлая программа' : 'Полезная ссылка',
        ...source,
        ...patch,
      }),
    );
  };
  return (
    <section className="create-references" aria-label="Материалы для программы">
      <details>
        <summary>
          Материалы для программы
          <span className="create-references-count">
            {previousPrograms.length + links.length || 'необязательно'}
          </span>
        </summary>
        <p>Добавьте прошлую программу или полезные ссылки. Содержимое ссылок не загружается.</p>
        {(previousPrograms.length ? previousPrograms : [undefined]).map((source, index) => (
          <div className="create-reference" key={index}>
            {source?.text && (
              <p className="create-reference-saved">{source.name} · текст сохранён</p>
            )}
            <Field label="Ссылка на прошлую программу" error={referenceUrlError(source?.url || '')}>
              <input
                type="url"
                required={!!source && !source.text.trim()}
                value={source?.url || ''}
                placeholder="https://…"
                onChange={(event) => update(source, { url: event.target.value }, true)}
              />
            </Field>
            {source && (
              <button type="button" className="link-button" onClick={() => remove(source)}>
                Убрать прошлую программу
              </button>
            )}
          </div>
        ))}
        {(links.length ? links : [undefined]).map((source, index) => (
          <div className="create-reference" key={index}>
            <Field label="Название ссылки" hint="Необязательно">
              <input
                value={source?.name || ''}
                onChange={(event) => update(source, { name: event.target.value }, false)}
              />
            </Field>
            <Field label="URL полезной ссылки" error={referenceUrlError(source?.url || '')}>
              <input
                type="url"
                required={!!source}
                value={source?.url || ''}
                placeholder="https://…"
                onChange={(event) => update(source, { url: event.target.value }, false)}
              />
            </Field>
            {source && (
              <button type="button" className="link-button" onClick={() => remove(source)}>
                Убрать ссылку
              </button>
            )}
          </div>
        ))}
        {!!links.length && (
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
      </details>
      <ReferenceEditor uploadOnly references={references} onChange={onChange} />
    </section>
  );
}
