import {
  professionalStandards,
  professionalStandardReferences,
} from '../../entities/course/model/professional-standards';
import {
  referenceUrlError,
  userReference,
  type Reference,
} from '../../entities/course/model/user-reference';
import { Field } from '../../shared/ui/ui';

export function ProfessionalStandardFields({
  reference,
  onChange,
  disabled = false,
}: {
  reference?: Reference;
  onChange: (reference: Reference | undefined) => void;
  disabled?: boolean;
}) {
  const standard = professionalStandards.find((standard) => standard.id === reference?.id);
  const selected = standard?.scenario || (reference ? 'custom' : '');
  const update = (patch: Partial<Pick<Reference, 'name' | 'text' | 'url'>>) =>
    onChange(userReference({ ...reference!, ...patch }));
  return (
    <>
      <Field label="Профстандарт программы">
        <select
          value={selected}
          disabled={disabled}
          onChange={(event) => {
            const scenario = event.target.value;
            onChange(
              scenario === 'custom'
                ? userReference({
                    id: `professional-standard-custom-${crypto.randomUUID()}`,
                    name: '',
                  })
                : professionalStandardReferences(scenario)[0],
            );
          }}
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
      {selected === 'custom' && reference && (
        <>
          <Field label="Название и код профстандарта">
            <input
              required
              disabled={disabled}
              value={reference.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          <Field label="Ссылка на профстандарт" error={referenceUrlError(reference.url)}>
            <input
              type="url"
              disabled={disabled}
              value={reference.url}
              onChange={(event) => update({ url: event.target.value })}
            />
          </Field>
          <Field label="Текст профстандарта">
            <textarea
              required
              rows={5}
              disabled={disabled}
              value={reference.text}
              onChange={(event) => update({ text: event.target.value })}
            />
          </Field>
        </>
      )}
    </>
  );
}
