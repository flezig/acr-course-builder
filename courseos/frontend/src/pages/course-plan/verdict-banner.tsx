import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import { programVerdict, questionCount } from '../../entities/course/model/rules';

// Вердикт наверху карточки программы. Отвечает на вопрос «можно ли утверждать сейчас»
// и ведёт к первому нерешённому вопросу очереди. Саму кнопку утверждения баннер
// не дублирует: она в шапке страницы.
export function VerdictBanner({
  snapshot,
  materialsHref,
}: {
  snapshot: Snapshot;
  materialsHref: string;
}) {
  const { search } = useLocation();
  const verdict = programVerdict(snapshot);
  const open = snapshot.audit.issues.filter((issue) => !issue.decision && issue.blocking);
  const action =
    verdict.kind === 'approved'
      ? { label: 'Перейти к материалам', to: materialsHref }
      : verdict.kind === 'ready'
        ? null
        : { label: 'К первому вопросу', to: { search, hash: `#issue-${verdict.first!.id}` } };
  return (
    <section className={`verdict verdict-${verdict.kind}`} aria-label="Решение по программе">
      <div className="verdict-body">
        <small>Можно ли утверждать программу?</small>
        <h2>
          {verdict.kind === 'approved' && <CheckCircle2 size={20} aria-hidden="true" />}
          {verdict.open > 0
            ? `${new Intl.PluralRules('ru').select(verdict.open) === 'one' ? 'Блокирует' : 'Блокируют'} утверждение: ${verdict.open}`
            : verdict.title}
        </h2>
        {verdict.kind === 'ready' && (
          <p className="verdict-evidence">
            Блокирующих вопросов нет. Утвердите программу кнопкой «Утвердить» вверху страницы.
          </p>
        )}
        {open.length > 0 && (
          <ol
            className="verdict-queue"
            aria-label={`Очередь решений: ${questionCount(open.length)}`}
          >
            {open.map((issue) => (
              <li key={issue.id}>
                <Link className="verdict-issue-link" to={{ search, hash: `#issue-${issue.id}` }}>
                  <span className="verdict-issue-label blocking" aria-label="Блокирует утверждение">
                    ●
                  </span>
                  <span className="verdict-issue-text">
                    <span className="verdict-issue-heading">{issue.message}</span>
                    {issue.evidence && (
                      <span className="verdict-evidence" title={issue.evidence}>
                        {issue.evidence}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
      {action && (
        <Link className="button primary" to={action.to}>
          {action.label}
          <ArrowRight size={16} />
        </Link>
      )}
    </section>
  );
}
