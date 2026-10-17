import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CircleAlert } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import {
  calendarExplanation,
  programVerdict,
  questionCount,
} from '../../entities/course/model/rules';

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
  // Сохранённый аудит может содержать старый текст; пояснение строим по параметрам календаря.
  const open = snapshot.audit.issues
    .filter((issue) => !issue.decision && issue.blocking)
    .map((issue) =>
      issue.id === 'calendar-unknown'
        ? { ...issue, evidence: calendarExplanation(snapshot.skeleton.requirements) }
        : issue,
    );
  const single = verdict.open === 1 ? open[0] : null;
  const calendarIssue = single?.id === 'calendar-unknown';
  const action =
    verdict.kind === 'approved'
      ? { label: 'Перейти к материалам', to: materialsHref }
      : verdict.kind === 'ready'
        ? null
        : {
            label: calendarIssue
              ? 'Уточнить сроки'
              : single
                ? 'Разобрать замечание'
                : 'Разобрать замечания',
            to: { search, hash: `#issue-${verdict.first!.id}` },
          };
  return (
    <section
      className={`verdict verdict-${verdict.kind}${single ? ' verdict-single' : ''}`}
      aria-label="Решение по программе"
    >
      <div className="verdict-body">
        <h2>
          {single && (
            <span className="verdict-issue-label blocking">
              <CircleAlert size={18} aria-hidden="true" />
            </span>
          )}
          {verdict.kind === 'approved' && <CheckCircle2 size={20} aria-hidden="true" />}
          <span>
            {single
              ? calendarIssue
                ? 'Перед утверждением уточните сроки'
                : single.message
              : verdict.open > 0
                ? `До утверждения — ${questionCount(verdict.open)}`
                : verdict.title}
          </span>
        </h2>
        {single?.evidence && <p className="verdict-evidence">{single.evidence}</p>}
        {verdict.kind === 'ready' && (
          <p className="verdict-evidence">
            Блокирующих вопросов нет. Утвердите программу кнопкой «Утвердить» вверху страницы.
          </p>
        )}
        {open.length > 1 && (
          <ol
            className="verdict-queue"
            aria-label={`Очередь решений: ${questionCount(open.length)}`}
          >
            {open.map((issue) => (
              <li key={issue.id}>
                <Link className="verdict-issue-link" to={{ search, hash: `#issue-${issue.id}` }}>
                  <span className="verdict-issue-label blocking">
                    <CircleAlert size={18} aria-hidden="true" />
                  </span>
                  <span className="verdict-issue-text">
                    <span className="verdict-issue-heading">{issue.message}</span>
                    {issue.evidence && <span className="verdict-evidence">{issue.evidence}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
        {action && (
          <Link className="button primary verdict-action" to={action.to}>
            {action.label}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )}
      </div>
    </section>
  );
}
