import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import { programVerdict, questionCount } from '../../entities/course/model/rules';

// Вердикт наверху карточки программы. Отвечает на вопрос «можно ли утверждать сейчас»
// и ведёт к первому нерешённому вопросу очереди.
export function VerdictBanner({
  snapshot,
  materialsHref,
}: {
  snapshot: Snapshot;
  materialsHref: string;
}) {
  const { search } = useLocation();
  const verdict = programVerdict(snapshot);
  const open = snapshot.audit.issues.filter((issue) => !issue.decision);
  const action =
    verdict.kind === 'approved'
      ? { label: 'Перейти к материалам', to: materialsHref }
      : verdict.kind === 'ready'
        ? { label: 'Перейти к утверждению', to: { search, hash: '#approve' } }
        : { label: 'К первому вопросу', to: { search, hash: `#issue-${verdict.first!.id}` } };
  return (
    <section className={`verdict verdict-${verdict.kind}`} aria-label="Решение по программе">
      <div className="verdict-body">
        <small>Можно ли утверждать программу?</small>
        <h2>
          {verdict.kind === 'approved' && <CheckCircle2 size={20} aria-hidden="true" />}
          {verdict.title}
        </h2>
        {verdict.kind === 'ready' && (
          <p className="verdict-evidence">
            Блокирующих вопросов нет.
            {verdict.info ? ` К сведению: ${verdict.info}.` : ''} Утверждение остаётся решением
            методиста.
          </p>
        )}
        {open.length > 0 && (
          <ol
            className="verdict-queue"
            aria-label={`Очередь решений: ${questionCount(open.length)}`}
          >
            {open.map((issue) => (
              <li key={issue.id}>
                <div className="verdict-issue-heading">
                  <span className={`verdict-issue-label ${issue.blocking ? 'blocking' : ''}`}>
                    {issue.blocking ? 'Блокирует утверждение' : 'К сведению'}
                  </span>
                  <Link to={{ search, hash: `#issue-${issue.id}` }}>{issue.message}</Link>
                </div>
                {issue.evidence && <p className="verdict-evidence">{issue.evidence}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <Link className="button primary" to={action.to}>
        {action.label}
        <ArrowRight size={16} />
      </Link>
    </section>
  );
}
