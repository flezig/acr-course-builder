import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import { programVerdict, questionCount } from '../../entities/course/model/rules';
import { Panel } from '../../shared/ui/ui';
import { RationalePanel } from './rationale-panel';
import { DecisionQueue } from './decision-queue';
import './review-workspace.css';

type Section = 'issues' | 'rationale';
type Context = { section: Section };
const sections: Section[] = ['issues', 'rationale'];

export function ReviewWorkspace({
  snapshot,
  target,
  visible,
  auditHref,
  isLatest,
  active,
  editing,
  openEditor,
  issuePlace,
  issueHref,
  onDecided,
}: {
  snapshot: Snapshot;
  target: string;
  visible: boolean;
  auditHref: string;
  isLatest: boolean;
  active: boolean;
  editing: boolean;
  openEditor: () => void;
  issuePlace: (id: string) => string;
  issueHref: (id: string, issueId: string) => string;
  onDecided: (message: string) => void;
}) {
  const verdict = programVerdict(snapshot);
  const issues = snapshot.audit.issues;
  // Latest revisions share navigation context; archived versions keep their own context.
  const storageKey = `courseos-review:${snapshot.course_id}:${isLatest ? 'latest' : snapshot.course_version}`;
  const [context, setContext] = useState<Context>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (saved && sections.includes(saved.section)) return saved;
    } catch {
      /* A storage restriction must not prevent review. */
    }
    return { section: 'issues' };
  });
  const section = context.section;
  const selectSection = (section: Section) => setContext((previous) => ({ ...previous, section }));
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(context));
    } catch {
      /* Optional persistence. */
    }
  }, [storageKey, context]);
  useEffect(() => {
    if (!visible) return;
    if (target.startsWith('issue-') && issues.some((issue) => `issue-${issue.id}` === target))
      setContext({ section: 'issues' });
  }, [target, visible]);
  // Утверждение — в шапке страницы, переход к вопросу или материалам — в баннере над вкладками.
  // Здесь только то, что мешает работать с проверкой прямо сейчас.
  const reason = !isLatest
    ? 'Архивная версия: утверждение доступно в актуальной версии.'
    : active
      ? 'Дождитесь завершения текущей операции.'
      : editing
        ? 'Сначала сохраните или закройте редактор.'
        : '';
  const labels = [`Решения · ${verdict.open}`, 'Обоснования'];
  return (
    <div className="review-workspace">
      <section className="review-summary" aria-label="Состояние программы">
        <dl>
          <div>
            <dt>Вопросы, блокирующие утверждение</dt>
            <dd>{verdict.open}</dd>
          </div>
          <div>
            <dt>К сведению</dt>
            <dd>{verdict.info}</dd>
          </div>
        </dl>
      </section>
      <div className="review-controls">
        {reason && (
          <div className="review-action-bar">
            <div>
              <small>{reason}</small>
              {isLatest && editing && (
                <button className="link-button" onClick={openEditor}>
                  К редактору
                </button>
              )}
              {isLatest && active && (
                <button
                  className="link-button"
                  onClick={() => {
                    const log = document.querySelector<HTMLDetailsElement>('.operation-log');
                    if (!log) return;
                    log.open = true;
                    log.scrollIntoView({ block: 'start' });
                    log.querySelector('summary')?.focus({ preventScroll: true });
                  }}
                >
                  К текущей операции
                </button>
              )}
            </div>
            {!isLatest && (
              <Link className="button secondary" to={`/courses/${snapshot.course_id}/plan#review`}>
                К актуальной версии
              </Link>
            )}
          </div>
        )}
        <nav
          className="review-local-nav"
          aria-label="Проверка программы"
          role="tablist"
          onKeyDown={(event) => {
            const current = sections.indexOf(section);
            const next =
              event.key === 'ArrowRight'
                ? (current + 1) % sections.length
                : event.key === 'ArrowLeft'
                  ? (current + sections.length - 1) % sections.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? sections.length - 1
                      : -1;
            if (next < 0) return;
            event.preventDefault();
            selectSection(sections[next]);
            document.getElementById(`review-tab-${sections[next]}`)?.focus();
          }}
        >
          {sections.map((id, index) => (
            <button
              key={id}
              id={`review-tab-${id}`}
              role="tab"
              aria-selected={section === id}
              aria-controls={`review-${id}`}
              tabIndex={section === id ? 0 : -1}
              onClick={() => selectSection(id)}
            >
              {labels[index]}
            </button>
          ))}
        </nav>
      </div>
      <section
        id="review-issues"
        role="tabpanel"
        aria-labelledby="review-tab-issues"
        tabIndex={0}
        hidden={section !== 'issues'}
      >
        <Panel
          title="Очередь решений"
          subtitle="Сначала то, что блокирует утверждение, затем сведения. Применённое предложение создаёт новую версию."
          className="review-panel"
        >
          <DecisionQueue
            snapshot={snapshot}
            target={target}
            readonly={!isLatest || active || editing}
            issuePlace={issuePlace}
            issueHref={issueHref}
            onDecided={onDecided}
          />
        </Panel>
      </section>
      <section
        id="review-rationale"
        role="tabpanel"
        aria-labelledby="review-tab-rationale"
        tabIndex={0}
        hidden={section !== 'rationale'}
      >
        <RationalePanel snapshot={snapshot} />
        <Panel title="Проверка и утверждения" className="approval-records">
          <Link className="button secondary approval-report" to={auditHref}>
            <FileText size={16} aria-hidden="true" />
            Отчёт проверки программы
          </Link>
          {snapshot.approvals.length > 0 ? (
            <ul className="approval-history" aria-label="История утверждений">
              {snapshot.approvals.map((approval) => (
                <li key={approval.approved_at}>
                  Версия {approval.skeleton_version} утверждена ·{' '}
                  {new Date(approval.approved_at).toLocaleString('ru-RU')} · {approval.actor_id}
                </li>
              ))}
            </ul>
          ) : (
            <p className="approval-history">Программа ещё не утверждалась.</p>
          )}
        </Panel>
      </section>
    </div>
  );
}
