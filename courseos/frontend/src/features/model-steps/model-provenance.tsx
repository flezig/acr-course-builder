import type { ModelDesign } from '../../entities/course/model/schema';
import { Notice } from '../../shared/ui/ui';
import { describeUsage } from './model-steps';
import './model-provenance.css';

// Методист должен видеть, какая часть каркаса предложена моделью и во что она обошлась:
// это основание для проверки и данные для расчёта стоимости генерации.
export function ModelProvenance({ design }: { design: ModelDesign | undefined }) {
  if (!design) return null;
  return (
    <div className="model-provenance">
      <Notice tone={design.issues.length ? 'warning' : 'info'}>
        <p>
          Цель, результаты, модули и темы предложены моделью; часы распределила и проверила
          программа. Проверьте предметную точность перед утверждением.
        </p>
        {design.issues.map((issue) => (
          <p key={issue}>{issue}</p>
        ))}
        <small>{describeUsage(design.generated_by)}</small>
      </Notice>
    </div>
  );
}
