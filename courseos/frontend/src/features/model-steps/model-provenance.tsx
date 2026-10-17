import type { ModelDesign } from '../../entities/course/model/schema';
import { Badge, Notice } from '../../shared/ui/ui';
import { describeUsage } from './model-steps';
import './model-provenance.css';

const realismLabels = {
  achievable: { label: 'Цель достижима за объём', tone: 'green' },
  partly: { label: 'Цель достижима частично', tone: 'amber' },
  not_achievable: { label: 'Цель не достижима за объём', tone: 'red' },
} as const;

// Методист должен видеть, какая часть каркаса предложена моделью и во что она обошлась,
// а также почему программа такая: на что она опирается и успеют ли слушатели достичь цели.
export function ModelProvenance({ design }: { design: ModelDesign | undefined }) {
  if (!design) return null;
  const notes = design.design_notes;
  const realism = notes ? realismLabels[notes.realism] : null;
  return (
    <div className="model-provenance">
      <Notice
        tone={
          design.issues.length || (notes && notes.realism !== 'achievable') ? 'warning' : 'info'
        }
      >
        <p>
          Цель, результаты, модули и темы предложены моделью; часы распределила и проверила
          программа. Проверьте предметную точность перед утверждением.
        </p>
        {notes && (
          <dl className="model-notes">
            {realism && (
              <>
                <dt>Реалистичность</dt>
                <dd>
                  <Badge tone={realism.tone}>{realism.label}</Badge> {notes.realism_reason}
                  {notes.recommendation && (
                    <strong className="model-recommendation">
                      Рекомендация: {notes.recommendation}
                    </strong>
                  )}
                </dd>
              </>
            )}
            {notes.entry_basis && (
              <>
                <dt>Опирается на входной уровень</dt>
                <dd>{notes.entry_basis}</dd>
              </>
            )}
            {notes.added_basics.length > 0 && (
              <>
                <dt>Добавлено для входного уровня</dt>
                <dd>{notes.added_basics.join('; ')}</dd>
              </>
            )}
          </dl>
        )}
        {design.issues.map((issue) => (
          <p key={issue}>{issue}</p>
        ))}
        <small>{describeUsage(design.generated_by)}</small>
      </Notice>
    </div>
  );
}
