import type { ReactNode } from 'react';
import { Check, Trash2 } from 'lucide-react';
import type { Skeleton } from '../../entities/course/model/schema';
import { kindLabels } from '../../entities/course/model/presets';
import './outcome-editor-card.css';

type OutcomeKind = Skeleton['outcomes'][number]['kind'];

export function OutcomeEditorCard({
  number,
  kind,
  categoryName,
  onKindChange,
  onRemove,
  children,
}: {
  number: number;
  kind: OutcomeKind;
  categoryName: string;
  onKindChange: (kind: OutcomeKind) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`outcome-editor outcome-editor-card outcome-editor-${kind}`}
      role="group"
      aria-label={`Результат ${number}`}
    >
      <button
        type="button"
        className="outcome-remove"
        aria-label={`Удалить результат ${number}`}
        title="Удалить результат"
        onClick={onRemove}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
      {children}
      <fieldset className="outcome-kind-picker" aria-label={`Категория результата ${number}`}>
        <legend>Тип результата</legend>
        <div className="outcome-kind-options">
          {(Object.keys(kindLabels) as OutcomeKind[]).map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={categoryName}
                value={option}
                checked={kind === option}
                onChange={() => onKindChange(option)}
              />
              <span>
                <Check size={14} className="outcome-kind-check" aria-hidden="true" />
                {kindLabels[option]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
