import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import { rationaleCoverage } from '../../entities/course/model/rationale';
import { Badge, Notice, Panel } from '../../shared/ui/ui';
import { RationalePanel } from './rationale-panel';
import './review-workspace.css';

type Section = 'issues' | 'rationale' | 'approval';
type Context = { section: Section; issueId: string; detail: boolean };
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
}) {
  const issues = [...snapshot.audit.issues].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  const blocking = issues.filter((issue) => issue.blocking);
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
    return {
      section: issues.length ? 'issues' : 'approval',
      issueId: issues[0]?.id || '',
      detail: false,
    };
  });
  const selected = issues.find((issue) => issue.id === context.issueId) || issues[0];
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
    if (!visible || !target.startsWith('issue-')) return;
    const id = target.slice(6);
    if (issues.some((issue) => issue.id === id)) {
      setContext({ section: 'issues', issueId: id, detail: true });
    }
  }, [target, visible]);
  const openSection = (section: Section) => {
    selectSection(section);
    requestAnimationFrame(() => {
      const panel = document.getElementById(`review-${section}`);
      panel?.scrollIntoView({ block: 'start' });
      panel?.focus({ preventScroll: true });
    });
  };
  const status = snapshot.approval_applicable
    ? 'Программа утверждена'
    : blocking.length
      ? 'Нужны исправления'
      : 'Готово к утверждению';
  const reason = !isLatest
    ? 'Архивная версия: утверждение доступно в актуальной версии.'
    : active
      ? 'Дождитесь завершения текущей операции.'
      : editing
        ? 'Сначала сохраните или закройте редактор.'
        : blocking.length
          ? `Утверждение недоступно: ${blocking[0].message}`
          : !snapshot.approval_applicable && !confirmed
            ? 'Перед утверждением обязательно подтвердите проверку методистом.'
            : '';
  const action = snapshot.approval_applicable
    ? 'Перейти к материалам'
    : blocking.length
      ? 'Разобрать замечания'
      : 'Перейти к утверждению';
  const labels = [`Замечания · ${issues.length}`, 'Обоснования', 'Утверждение'];
  return (
    <div className="review-workspace">
      <section className="review-summary" aria-label="Состояние программы">
        <h2>{status}</h2>
        <dl>
          <div>
            <dt>Блокирующие замечания</dt>
            <dd>{blocking.length}</dd>
          </div>
          <div>
            <dt>Замечания к сведению</dt>
            <dd>{issues.length - blocking.length}</dd>
          </div>
          <div className="review-human-count">
            <dt>Решения для проверки методистом</dt>
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
            <strong>{status}</strong>
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
              onClick={() => openSection(blocking.length ? 'issues' : 'approval')}
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
          title="Замечания к программе"
          subtitle="Сначала блокирующие проблемы. Исправления создают новую ревизию и пересчитывают проверки."
          className="review-panel"
        >
          {!selected ? (
            <Notice tone="success">
              Замечаний нет. Проверьте содержание и основания перед утверждением.
            </Notice>
          ) : (
            <div className={`review-issues-layout ${context.detail ? 'show-detail' : ''}`}>
              <nav className="review-issue-list" aria-label="Список замечаний">
                {issues.map((issue) => (
                  <button
                    key={issue.id}
                    aria-current={selected.id === issue.id ? 'true' : undefined}
                    onClick={() => {
                      setContext({ section: 'issues', issueId: issue.id, detail: true });
                      requestAnimationFrame(() =>
                        document.getElementById(`issue-${issue.id}`)?.focus(),
                      );
                    }}
                  >
                    <strong>{issue.message}</strong>
                    <span>{issuePlace(issue.element_id)}</span>
                    <Badge tone={issue.blocking ? 'amber' : 'neutral'}>
                      {issue.blocking ? 'Блокирует утверждение' : 'К сведению'}
                    </Badge>
                  </button>
                ))}
              </nav>
              <article
                className={`review-issue ${target === `issue-${selected.id}` ? 'field-highlight' : ''}`}
                id={`issue-${selected.id}`}
                tabIndex={-1}
              >
                <button
                  className="review-back link-button"
                  onClick={() => {
                    setContext((previous) => ({ ...previous, detail: false }));
                    requestAnimationFrame(() =>
                      document
                        .querySelector<HTMLButtonElement>('.review-issue-list button[aria-current]')
                        ?.focus(),
                    );
                  }}
                >
                  <ArrowLeft size={15} />К списку замечаний
                </button>
                <div className="toolbar">
                  <Badge tone={selected.blocking ? 'amber' : 'neutral'}>
                    {selected.blocking ? 'Нужны исправления' : 'К сведению'}
                  </Badge>
                  <span className="check-origin">
                    {selected.check_type === 'rule'
                      ? 'Автоматическая проверка'
                      : selected.check_type === 'human'
                        ? 'Оценка методиста'
                        : 'Модельная проверка'}
                  </span>
                </div>
                <h3>{selected.message}</h3>
                <p className="issue-place">{issuePlace(selected.element_id)}</p>
                <h4>Рекомендуемое исправление</h4>
                <p>{selected.suggested_fix}</p>
                <Link
                  className="button secondary"
                  to={issueHref(selected.element_id, selected.id)}
                  onClick={() =>
                    setContext({ section: 'issues', issueId: selected.id, detail: true })
                  }
                >
                  Перейти к исправлению
                  <ArrowRight size={15} />
                </Link>
                <details>
                  <summary>Причина и технические подробности</summary>
                  <p>Ожидается: {selected.expected}</p>
                  <p>Фактически: {selected.actual}</p>
                </details>
              </article>
            </div>
          )}
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
