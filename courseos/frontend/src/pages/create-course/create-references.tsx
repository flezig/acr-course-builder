import type { Requirements } from '../../entities/course/model/schema';
import { isProfessionalStandardReference } from '../../entities/course/model/professional-standards';
import {
  referenceUrlError,
  userReference,
  type Reference,
} from '../../entities/course/model/user-reference';
import { ProfessionalStandardFields } from '../../features/professional-standard/professional-standard-fields';
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
  const standard = references.find(isProfessionalStandardReference);
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
        name: previous ? 'Прошлая программа' : '',
        ...source,
        ...patch,
      }),
    );
  };
  return (
    <section className="create-references" aria-labelledby="create-references-title">
      <h3 id="create-references-title">Референсы</h3>
      <p>Добавьте материалы, на которые должна опираться программа. Это необязательно.</p>
      <details>
        <summary>
          Прошлая программа{previousPrograms.length ? ` · ${previousPrograms.length}` : ''}
        </summary>
        {(previousPrograms.length ? previousPrograms : [undefined]).map((source, index) => (
          <div className="create-reference" key={index}>
            <Field label="Название прошлой программы">
              <input
                value={source?.name || ''}
                placeholder="Прошлая программа"
                onChange={(event) => update(source, { name: event.target.value }, true)}
              />
            </Field>
            <Field label="Текст прошлой программы">
              <textarea
                rows={3}
                required={!!source}
                value={source?.text || ''}
                placeholder="Вставьте программу целиком или нужный фрагмент"
                onChange={(event) => update(source, { text: event.target.value }, true)}
              />
            </Field>
            <Field label="Ссылка на прошлую программу" error={referenceUrlError(source?.url || '')}>
              <input
                type="url"
                value={source?.url || ''}
                placeholder="https://… (необязательно)"
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
      </details>
      <details>
        <summary>Профстандарт{standard ? ' · Выбран' : ' · Без профстандарта'}</summary>
        <ProfessionalStandardFields
          reference={standard}
          onChange={(replacement) =>
            onChange([
              ...references.filter((reference) => !isProfessionalStandardReference(reference)),
              ...(replacement ? [replacement] : []),
            ])
          }
        />
      </details>
      <details>
        <summary>Полезные ссылки{links.length ? ` · ${links.length}` : ''}</summary>
        <p>Ссылки сохраняются без загрузки содержимого.</p>
        {(links.length ? links : [undefined]).map((source, index) => (
          <div className="create-reference" key={index}>
            <Field label="Название ссылки">
              <input
                required={!!source}
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
