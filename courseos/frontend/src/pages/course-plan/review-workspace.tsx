import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import { rationaleCoverage } from '../../entities/course/model/rationale';
import { programVerdict, questionCount } from '../../entities/course/model/rules';
import { Panel } from '../../shared/ui/ui';
import { RationalePanel } from './rationale-panel';
import { DecisionQueue } from './decision-queue';
import './review-workspace.css';

type Section = 'issues' | 'rationale' | 'approval';
type Context = { section: Section };
const sections: Section[] = ['issues', 'rationale', 'approval'];

export function ReviewWorkspace({
  snapshot,
  target,
  visible,
  approval,
  isLatest,
  active,
  editing,
  confirmed,
  openEditor,
  issuePlace,
  issueHref,
  materialsHref,
  onDecided,
}: {
  snapshot: Snapshot;
  target: string;
  visible: boolean;
  approval: ReactNode;
  isLatest: boolean;
  active: boolean;
  editing: boolean;
  confirmed: boolean;
  openEditor: () => void;
  issuePlace: (id: string) => string;
  issueHref: (id: string, issueId: string) => string;
  materialsHref: string;
  onDecided: (message: string) => void;
}) {
  const verdict = programVerdict(snapshot);
  const issues = snapshot.audit.issues;
  const coverage = rationaleCoverage(snapshot.skeleton);
  const reviewCount = coverage.assumptions + coverage.gaps;
  // Latest revisions share navigation context; archived versions keep their own context.
  const storageKey = `courseos-review:${snapshot.course_id}:${isLatest ? 'latest' : snapshot.course_version}`;
  const [context, setContext] = useState<Context>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (saved && sections.includes(saved.section)) return saved;
    } catch {
      /* A storage restriction must not prevent review. */
    }
    return { section: verdict.open ? 'issues' : 'approval' };
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
    if (target === 'approve') setContext({ section: 'approval' });
    // Пока есть нерешённые вопросы, вкладка открывается на очереди, а не на утверждении.
    else if (target === 'review' && verdict.open && section === 'approval')
      setContext({ section: 'issues' });
    else if (target.startsWith('issue-') && issues.some((issue) => `issue-${issue.id}` === target))
      setContext({ section: 'issues' });
  }, [target, visible, verdict.open]);
  const openSection = (section: Section) => {
    selectSection(section);
    requestAnimationFrame(() => {
      const panel = document.getElementById(`review-${section}`);
      panel?.scrollIntoView({ block: 'start' });
      panel?.focus({ preventScroll: true });
    });
  };
  const reason = !isLatest
    ? 'Архивная версия: утверждение доступно в актуальной версии.'
    : active
      ? 'Дождитесь завершения текущей операции.'
      : editing
        ? 'Сначала сохраните или закройте редактор.'
        : verdict.open
          ? `До утверждения: ${questionCount(verdict.open)}`
          : !snapshot.approval_applicable && !confirmed
            ? 'Перед утверждением обязательно подтвердите проверку методистом.'
            : '';
  const action = snapshot.approval_applicable
    ? 'Перейти к материалам'
    : verdict.open
      ? 'К первому вопросу'
      : 'Перейти к утверждению';
  const labels = [`Решения · ${verdict.open}`, 'Обоснования', 'Утверждение'];
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
          <div className="review-human-count">
            <dt>Обоснования для проверки методистом</dt>
            <dd>{reviewCount}</dd>
          </div>
        </dl>
        <p>
          Автоматические проверки и оценка методиста учитываются отдельно.{' '}
          {snapshot.approval_applicable
            ? 'Основания доступны для последующего пересмотра.'
            : 'Отсутствие ошибок не заменяет проверку методистом.'}
        </p>
      </section>
      <div className="review-controls">
        <div className="review-action-bar">
          <div>
            {reason && <small>{reason}</small>}
            {isLatest && editing && (
              <button className="link-button" onClick={openEditor}>
                К редактору
              </button>
            )}
            {isLatest && active && (
              <button
                className="link-button"
                onClick={() => {
                  openSection('approval');
                  requestAnimationFrame(() => {
                    const log = document.querySelector<HTMLDetailsElement>('.operation-log');
                    if (log) {
                      log.open = true;
                      log.querySelector('summary')?.focus();
                    }
                  });
                }}
              >
                К текущей операции
              </button>
            )}
          </div>
          {!isLatest ? (
            <Link className="button secondary" to={`/courses/${snapshot.course_id}/plan#review`}>
              К актуальной версии
            </Link>
          ) : snapshot.approval_applicable ? (
            <Link className="button primary" to={materialsHref}>
              {action}
              <ArrowRight size={15} />
            </Link>
          ) : (
            <button
              className="primary"
              onClick={() => {
                openSection(verdict.open ? 'issues' : 'approval');
                if (verdict.open && verdict.first)
                  requestAnimationFrame(() =>
                    document.getElementById(`issue-${verdict.first!.id}`)?.focus(),
                  );
              }}
            >
              {action}
              <ArrowRight size={15} />
            </button>
          )}
        </div>
        <nav
          className="review-local-nav"
          aria-label="Проверка программы"
          role="tablist"
          onKeyDown={(event) => {
            const current = sections.indexOf(section);
            const next =
              event.key === 'ArrowRight'
                ? (current + 1) % 3
                : event.key === 'ArrowLeft'
                  ? (current + 2) % 3
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? 2
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
          subtitle="Сначала то, что блокирует утверждение, затем сведения. Применённое предложение создаёт новую ревизию."
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
      </section>
      <section
        id="review-approval"
        role="tabpanel"
        aria-labelledby="review-tab-approval"
        tabIndex={0}
        hidden={section !== 'approval'}
      >
        {approval}
      </section>
    </div>
  );
}
