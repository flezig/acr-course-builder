import { ProfessionalStandardEditor } from './professional-standard-editor';
import { professionalStandardEvidence } from '../../entities/course/model/professional-standards';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Pencil, ChevronDown, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useCommand, useCourse } from '../../entities/course/api/provider';
import { programVerdict, questionCount } from '../../entities/course/model/rules';
import { kindLabels } from '../../entities/course/model/presets';
import {
  inputSchema,
  type CourseView,
  type Requirements,
} from '../../entities/course/model/schema';
import { JobPanel } from '../../entities/job/job-panel';
import {
  Form,
  Badge,
  Empty,
  ErrorMessage,
  Field,
  Loading,
  Notice,
  Panel,
} from '../../shared/ui/ui';
import { ReviewWorkspace } from './review-workspace';
import { CalendarPanel } from './calendar-panel';
import { SkeletonEditor } from './skeleton-editor';
import { IntentBlockEditor, type IntentBlock } from './intent-block-editor';
import { CurriculumTable, VolumeSummary } from './curriculum-table';
import { CoverageMatrix } from '../competencies/coverage-matrix';
import { VerdictBanner } from './verdict-banner';
import './decision.css';
const conciseOutcomes: Record<string, string> = {
  'Риски, этика и данные детей': 'Оценивает риски и защищает данные детей',
  'Запрос и проверка ответа ИИ': 'Составляет запрос и проверяет ответ ИИ',
  'План урока': 'Создаёт план урока',
  'Задания для учеников': 'Готовит задания для учеников',
};
function outcomeText(description: string) {
  const match = description.match(/^Выполняет учебную задачу «(.+)» и объясняет решение$/);
  return match
    ? conciseOutcomes[match[1]] || `Выполняет учебную задачу «${match[1]}»`
    : description;
}
const displayHours = (text: string) =>
  text
    .replace(/(\d)\.(\d+)(?=\s*(?:ч|уч\. ч|[+×=−;]|$))/g, '$1,$2')
    .replace(/(\d) ч(?=[\s.,]|$)/g, '$1 уч. ч.');
export function PlanPage() {
  const query = useCourse();
  const location = useLocation();
  const navigate = useNavigate();
  const command = useCommand();
  const [editing, setEditing] = useState(false);
  const [coverageEditTarget, setCoverageEditTarget] = useState<string | undefined>();
  const [blockEditing, setBlockEditing] = useState<IntentBlock | null>(null);
  const [saved, setSaved] = useState('');
  const [correction, setCorrection] = useState('');
  const [approveConfirmed, setApproveConfirmed] = useState(false);
  const hash = decodeURIComponent(location.hash.slice(1));
  const snapshot = query.data?.snapshot;
  const [target, selectedIssueId] = hash.replace(/^fix-/, '').split('~');
  // Учебный план открывается первым: после вердикта методист смотрит часы и покрытие.
  const tab =
    target === 'review' || target === 'approve' || target.startsWith('issue-')
      ? 'review'
      : target === 'calendar'
        ? 'calendar'
        : !target ||
            target === 'curriculum' ||
            target.startsWith('coverage') ||
            target.startsWith('topic-')
          ? 'curriculum'
          : 'intent';
  useEffect(() => {
    if (hash.startsWith('fix-topic-') && query.data?.is_latest) setEditing(true);
    if (hash.startsWith('fix-outcome-') && query.data?.is_latest) setEditing(true);
  }, [hash, query.data?.is_latest]);
  useEffect(() => {
    if (query.data?.is_latest === false) {
      setEditing(false);
      setBlockEditing(null);
    }
  }, [query.data?.is_latest]);
  useEffect(() => setApproveConfirmed(false), [snapshot?.course_version]);
  useEffect(() => {
    if (
      !snapshot ||
      !hash ||
      hash.startsWith('fix-topic-') ||
      hash.startsWith('fix-outcome-') ||
      hash === 'fix-calendar'
    )
      return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(hash) || document.getElementById(target);
      if (!element) return;
      let parent = element.closest('details');
      while (parent) {
        parent.open = true;
        parent = parent.parentElement?.closest('details') || null;
      }
      const section = ['intent', 'curriculum', 'calendar', 'review', 'approve'].includes(hash);
      if (section) return;
      element.scrollIntoView({ block: 'center' });
      if (target.startsWith('issue-')) {
        element.focus({ preventScroll: true });
        return;
      }
      const field =
        element.querySelector<HTMLElement>('textarea, input') ||
        element.querySelector<HTMLElement>('summary, button');
      (field || element).focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, target, snapshot?.course_version]);
  if (query.isPending) return <Loading />;
  if (!query.data) return <ErrorMessage error={query.error} />;
  const view = query.data;
  if (!snapshot)
    return (
      <>
        <header className="page-heading">
          <h1>{view.requirements.title}</h1>
        </header>
        <JobPanel job={view.job} version={0} />
        {view.questions.length > 0 ? (
          <Clarifications view={view} />
        ) : (
          <Empty title="Готовим каркас">
            Параметры сохранены. Содержание появится после построения каркаса.
          </Empty>
        )}
      </>
    );
  const skeleton = snapshot.skeleton;
  const verdict = programVerdict(snapshot);
  const sharedDepth =
    skeleton.outcomes.length > 0 &&
    skeleton.outcomes.every((outcome) => outcome.depth === skeleton.outcomes[0].depth)
      ? skeleton.outcomes[0].depth
      : null;
  const issues = snapshot.audit.issues;
  const active = ['queued', 'running'].includes(view.job.status);
  const readonly = !view.is_latest || active;
  const canEdit = !readonly && !editing && !blockEditing;
  const versionQuery = view.is_latest ? '' : `?version=${snapshot.course_version}`;
  const href = (page: string) => `/courses/${view.course_id}/${page}${versionQuery}`;
  const issuePlace = (id: string) =>
    id === 'calendar'
      ? 'Календарь · параметры нагрузки'
      : id === 'legal'
        ? 'О программе · основания разработки'
        : id === 'tools'
          ? 'О программе · инструменты'
          : id === 'curriculum'
            ? 'Учебный план'
            : skeleton.requirements.references.find((reference) => reference.id === id)
              ? `Приложение · ${skeleton.requirements.references.find((reference) => reference.id === id)!.name}`
              : skeleton.topics.find((topic) => topic.id === id)?.title
                ? `Учебный план · ${skeleton.topics.find((topic) => topic.id === id)!.title}`
                : skeleton.outcomes.find((outcome) => outcome.id === id)?.description
                  ? `О программе · ${outcomeText(skeleton.outcomes.find((outcome) => outcome.id === id)!.description)}`
                  : skeleton.explanations.find((explanation) => explanation.id === id)?.title ||
                    'Проверка программы';
  const issueHref = (id: string, issueId: string) =>
    id === 'legal' || id === 'tools'
      ? `${href('plan')}#${id === 'legal' ? 'standard' : 'tools'}`
      : id === 'curriculum'
        ? `${href('plan')}#curriculum`
        : skeleton.requirements.references.some((reference) => reference.id === id)
          ? `${href('map')}#${id}`
          : id === 'calendar' ||
              skeleton.topics.some((topic) => topic.id === id) ||
              skeleton.outcomes.some((outcome) => outcome.id === id) ||
              skeleton.explanations.some((explanation) => explanation.id === id)
            ? `${href('plan')}#fix-${id}${snapshot.observations.some((issue) => issue.id === issueId) ? `~${issueId}` : ''}`
            : `${href('audit')}#issue-${issueId}`;
  const editButton = (block: IntentBlock, label: string) => (
    <button
      className="block-edit"
      disabled={!canEdit}
      onClick={() => {
        setSaved('');
        setBlockEditing(block);
      }}
      aria-label={`Изменить ${label}`}
    >
      <Pencil size={14} />
      Изменить
    </button>
  );
  const blockEditor = (block: IntentBlock) => (
    <IntentBlockEditor
      key={`${snapshot.course_id}-${block}`}
      snapshot={snapshot}
      block={block}
      focusOutcome={target}
      close={() => setBlockEditing(null)}
      saved={() => {
        setBlockEditing(null);
        setSaved('Изменения сохранены. Проверки пересчитаны.');
      }}
    />
  );
  return (
    <div className="plan-workspace">
      <header className="page-heading course-heading">
        <div className="course-banner">
          <div className="eyebrow">Программа курса</div>
          <h1>{skeleton.requirements.title}</h1>
          <div className="course-meta">
            <span>{skeleton.requirements.audience}</span>
            <span>{skeleton.requirements.delivery}</span>
          </div>
        </div>
        <button
          className="secondary edit-skeleton"
          onClick={() => {
            setCoverageEditTarget(undefined);
            setEditing(!editing);
            setSaved('');
          }}
          disabled={readonly || !!blockEditing}
        >
          <Pencil size={15} />
          {editing ? 'Редактор открыт' : 'Редактировать программу'}
        </button>
      </header>
      <VerdictBanner snapshot={snapshot} materialsHref={href('materials')} />
      <nav className="plan-nav" aria-label="Разделы программы">
        {(
          [
            ['curriculum', 'Учебный план'],
            ['intent', 'О программе'],
            ['calendar', 'Календарь'],
            ['review', 'Решения и утверждение'],
          ] as const
        ).map(([id, title]) => (
          <Link
            key={id}
            // Ссылка сохраняет ?version, иначе вкладка архивной версии открыла бы актуальную.
            to={{ search: location.search, hash: `#${id}` }}
            aria-label={title}
            aria-describedby={
              id === 'review' && verdict.open > 0 ? 'review-remark-count' : undefined
            }
            aria-current={tab === id ? 'page' : undefined}
          >
            {title}
            {id === 'review' && verdict.open > 0 && (
              <span
                id="review-remark-count"
                className="tab-count"
                aria-label={questionCount(verdict.open)}
              >
                {verdict.open}
              </span>
            )}
          </Link>
        ))}
      </nav>
      {!view.is_latest && (
        <Notice tone="warning">
          Архив версии {snapshot.course_version}. Доступен просмотр и скачивание; редактирование
          выполняется в актуальной версии.
        </Notice>
      )}
      {saved && (
        <div className="save-feedback" role="status">
          <CheckCircle2 size={16} />
          {saved}
        </div>
      )}
      <ErrorMessage error={query.error} />
      {editing && (
        <div id="program-editor">
          <SkeletonEditor
            snapshot={snapshot}
            focusTarget={coverageEditTarget || target}
            close={() => setEditing(false)}
            saved={() => {
              setEditing(false);
              setSaved('Изменения сохранены. Проверки пересчитаны.');
            }}
          />
        </div>
      )}
      <div className={`plan-layout ${tab !== 'intent' ? 'single-column' : ''}`}>
        <div>
          <div id="intent" hidden={tab !== 'intent'}>
            <Panel title="О программе" className="program-intent">
              <section className="intent-block" id="goal">
                <div className="block-heading">
                  <h3>Цель обучения</h3>
                  {editButton('goal', 'цель обучения')}
                </div>
                {blockEditing === 'goal' ? (
                  blockEditor('goal')
                ) : (
                  <p className="goal-statement">
                    {skeleton.goal || 'Цель обучения пока не указана'}
                  </p>
                )}
              </section>
              <section className="intent-block audience-block">
                <div className="block-heading">
                  <h3>Для кого эта программа</h3>
                  {editButton('audience', 'аудиторию и входной уровень')}
                </div>
                {blockEditing === 'audience' ? (
                  blockEditor('audience')
                ) : (
                  <dl className="audience-facts">
                    <div>
                      <dt>Аудитория</dt>
                      <dd>{skeleton.requirements.audience || 'Не указана'}</dd>
                    </div>
                    <div>
                      <dt>Входной уровень</dt>
                      <dd>{skeleton.requirements.entry_level || 'Не указан'}</dd>
                    </div>
                  </dl>
                )}
              </section>
              <section className="outcomes intent-block">
                <div className="block-heading">
                  <h3>
                    Результаты обучения{' '}
                    <span className="result-count">{skeleton.outcomes.length}</span>
                  </h3>
                  {editButton('outcomes', 'результаты обучения')}
                </div>
                {blockEditing === 'outcomes' ? (
                  blockEditor('outcomes')
                ) : (
                  <>
                    {!skeleton.outcomes.length && (
                      <p className="muted">
                        Результаты пока не заданы. Уточните исходные требования программы.
                      </p>
                    )}
                    {(['knowledge', 'skill', 'proficiency'] as const).map((kind) => {
                      const items = skeleton.outcomes.filter((outcome) => outcome.kind === kind);
                      return (
                        items.length > 0 && (
                          <section className="outcome-group" key={kind}>
                            <h4>{kindLabels[kind]}</h4>
                            <ul>
                              {items.map((outcome) => (
                                <li
                                  key={outcome.id}
                                  id={outcome.id}
                                  className={target === outcome.id ? 'field-highlight' : ''}
                                  tabIndex={-1}
                                >
                                  <div>
                                    {outcomeText(outcome.description)}
                                    {!sharedDepth && <small>{outcome.depth}</small>}
                                    {outcome.criteria && outcome.criteria.length > 0 && (
                                      <ul className="outcome-criteria" aria-label="Критерии">
                                        {outcome.criteria.map((criterion) => (
                                          <li key={criterion}>{criterion}</li>
                                        ))}
                                      </ul>
                                    )}
                                    {target === outcome.id && (
                                      <div className="context-remark">
                                        <AlertCircle size={15} />
                                        {
                                          issues.find((issue) => issue.element_id === outcome.id)
                                            ?.message
                                        }
                                        <button
                                          className="link-button"
                                          disabled={!canEdit}
                                          onClick={() => setBlockEditing('outcomes')}
                                        >
                                          Изменить результат
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </section>
                        )
                      );
                    })}
                    {sharedDepth && (
                      <p className="outcome-note">
                        {sharedDepth ===
                        'Базовое действие по образцу; требуется предметная проверка'
                          ? 'Работа выполняется по образцу. Результаты требуют предметной проверки.'
                          : sharedDepth}
                      </p>
                    )}
                  </>
                )}
              </section>
              <section className="intent-tasks">
                <div className="block-heading">
                  <h3>
                    Задачи программы <span className="result-count">{skeleton.tasks.length}</span>
                  </h3>
                  {editButton('tasks', 'задачи программы')}
                </div>
                {blockEditing === 'tasks' ? (
                  blockEditor('tasks')
                ) : (
                  <ul className="task-list">
                    {skeleton.tasks.map((task) => (
                      <li key={task}>{task}</li>
                    ))}
                  </ul>
                )}
              </section>
              {skeleton.requirements.template_id === 'acr_professional' && (
                <section className="intent-block" id="standard" tabIndex={-1}>
                  <h3>Профессиональный стандарт</h3>
                  {skeleton.outcomes.some((outcome) => outcome.professional_standard_code) ? (
                    <p>
                      {[...new Set(skeleton.outcomes.map((o) => o.professional_standard_code))]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  ) : (
                    <p className="pending-field">
                      {professionalStandardEvidence(skeleton.requirements)}
                    </p>
                  )}
                  {canEdit && (
                    <ProfessionalStandardEditor key={snapshot.course_version} snapshot={snapshot} />
                  )}
                </section>
              )}
              {skeleton.tools && skeleton.tools.length > 0 && (
                <section className="intent-block" id="tools" tabIndex={-1}>
                  <h3>Инструменты и версии</h3>
                  <div className="table-scroll">
                    <table className="tools-table">
                      <thead>
                        <tr>
                          <th>Инструмент</th>
                          <th>Для чего</th>
                          <th>Версия</th>
                          <th>Источник и дата проверки</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skeleton.tools.map((tool) => (
                          <tr key={tool.name}>
                            <th scope="row">{tool.name}</th>
                            <td>{tool.purpose}</td>
                            <td className={tool.version ? undefined : 'pending-field'}>
                              {tool.version || 'требует подтверждения'}
                            </td>
                            <td className={tool.source ? undefined : 'pending-field'}>
                              {tool.source
                                ? `${tool.source}, ${tool.checked_at}`
                                : 'источник не указан'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </Panel>
          </div>
          <div id="curriculum" hidden={tab !== 'curriculum'}>
            <div className="section-toolbar">
              <span>
                {
                  new Set(
                    skeleton.topics
                      .filter((topic) => topic.id !== 'topic-final')
                      .map((topic) => topic.module_id),
                  ).size
                }{' '}
                модулей · итоговая аттестация{' '}
                {skeleton.topics.at(-1)?.planned_total.replace('.', ',')} ч
              </span>
              <button className="block-edit" disabled={!canEdit} onClick={() => setEditing(true)}>
                <Pencil size={14} />
                Изменить план
              </button>
            </div>
            <Panel title="Учебный план" className="curriculum-panel">
              <VolumeSummary skeleton={skeleton} />
              <CurriculumTable skeleton={skeleton} focused={target} />
            </Panel>
            <CoverageMatrix
              snapshot={snapshot}
              planHref={href('plan')}
              editable={canEdit}
              edit={(id) => {
                setCoverageEditTarget(id);
                setEditing(true);
              }}
            />
          </div>
          <div hidden={tab !== 'calendar'}>
            <CalendarPanel
              key={`${snapshot.course_id}-${snapshot.course_version}`}
              snapshot={snapshot}
              readonly={readonly || editing || !!blockEditing}
              focusIssue={hash === 'fix-calendar'}
              saved={() => {
                setSaved(
                  'Календарь сохранён. Проверки пересчитаны; утверждение выполняется отдельно.',
                );
                navigate(`${location.pathname}${location.search}#calendar`, { replace: true });
              }}
            />
          </div>
          <div id="review" hidden={tab !== 'review'}>
            <ReviewWorkspace
              key={`${snapshot.course_id}-${view.is_latest ? 'latest' : snapshot.course_version}`}
              snapshot={snapshot}
              target={target}
              visible={tab === 'review'}
              isLatest={view.is_latest}
              active={active}
              editing={editing || !!blockEditing}
              confirmed={approveConfirmed}
              openEditor={() => {
                if (blockEditing) navigate(`${location.pathname}${location.search}#intent`);
                requestAnimationFrame(() => {
                  const editor = document.querySelector<HTMLElement>(
                    '#program-editor, .intent-editor',
                  );
                  editor?.scrollIntoView({ block: 'start' });
                  editor?.querySelector<HTMLElement>('textarea, input, button')?.focus();
                });
              }}
              issuePlace={issuePlace}
              issueHref={issueHref}
              materialsHref={href('materials')}
              onDecided={setSaved}
              approval={
                <>
                  <Panel
                    title={`Утверждение ревизии ${snapshot.skeleton_version}`}
                    className="approval-panel"
                  >
                    {!snapshot.approval_applicable ? (
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={approveConfirmed}
                          disabled={verdict.open > 0}
                          onChange={(event) => setApproveConfirmed(event.target.checked)}
                        />
                        Цель, результаты, часы, оценивание и основания проверены. Утверждаю эту
                        ревизию.
                      </label>
                    ) : (
                      <Notice tone="success">
                        Программа утверждена. Материалы создаются по этой программе.
                      </Notice>
                    )}
                    <button
                      className="primary"
                      disabled={
                        !view.is_latest ||
                        active ||
                        editing ||
                        !!blockEditing ||
                        verdict.open > 0 ||
                        snapshot.approval_applicable ||
                        !approveConfirmed ||
                        command.isPending
                      }
                      onClick={() =>
                        command.mutate({
                          action: 'approve',
                          expected_version: snapshot.course_version,
                          payload: {
                            skeleton_version: snapshot.skeleton_version,
                            skeleton_hash: snapshot.skeleton_hash,
                          },
                        })
                      }
                    >
                      {command.isPending ? 'Сохраняем утверждение…' : 'Утвердить программу'}
                      <ArrowRight size={17} />
                    </button>
                    {verdict.open > 0 && verdict.first ? (
                      <Link
                        className="approval-hint"
                        to={{ search: location.search, hash: `#issue-${verdict.first.id}` }}
                      >
                        Сначала закройте {verdict.open}{' '}
                        {new Intl.PluralRules('ru').select(verdict.open) === 'one'
                          ? 'блокирующий вопрос'
                          : new Intl.PluralRules('ru').select(verdict.open) === 'few'
                            ? 'блокирующих вопроса'
                            : 'блокирующих вопросов'}
                      </Link>
                    ) : !snapshot.approval_applicable && !approveConfirmed ? (
                      <p className="approval-hint">Отметьте подтверждение проверки</p>
                    ) : null}
                    {snapshot.approval_applicable && snapshot.materials.length > 0 && (
                      <Link className="button secondary" to={href('materials')}>
                        Проверить материалы <ArrowRight size={16} />
                      </Link>
                    )}
                    {editing && <small>Сначала сохраните или закройте редактор.</small>}
                    <ErrorMessage error={command.error} />
                    <Link className="button secondary approval-report" to={href('audit')}>
                      <FileText size={16} aria-hidden="true" />
                      Отчёт проверки программы
                    </Link>
                    <details className="approval-details">
                      <summary>
                        Сведения о ревизии и утверждении
                        <ChevronDown size={16} aria-hidden="true" />
                      </summary>
                      <code>
                        course_id: {snapshot.course_id}
                        <br />
                        course_version: {snapshot.course_version}
                        <br />
                        skeleton_version: {snapshot.skeleton_version}
                        <br />
                        SHA-256: {snapshot.skeleton_hash}
                      </code>
                      {snapshot.approvals.map((a) => (
                        <p key={a.approved_at}>
                          {a.actor_id} · ревизия {a.skeleton_version} ·{' '}
                          {new Date(a.approved_at).toLocaleString('ru-RU')}
                        </p>
                      ))}
                    </details>
                  </Panel>
                  <details className="operation-log">
                    <summary>Журнал операций</summary>
                    <JobPanel
                      job={view.job}
                      version={view.latest_version}
                      readonly={!view.is_latest}
                      compact
                    />
                  </details>
                </>
              }
            />
          </div>
        </div>
        <aside className="explanations" hidden={tab !== 'intent'}>
          <Panel
            title="Обоснование программы"
            subtitle="Расчёты системы и содержательная оценка методиста."
          >
            {skeleton.explanations.map((savedExplanation) => {
              const explanation = savedExplanation;
              return (
                <details
                  className={`explanation ${target === explanation.id ? 'field-highlight' : ''}`}
                  key={explanation.id}
                  id={explanation.id}
                  open={target === explanation.id || undefined}
                >
                  <summary>
                    <div>
                      <h3>{explanation.title}</h3>
                      <p>{displayHours(explanation.conclusion)}</p>
                      <Badge
                        tone={
                          explanation.status === 'blocked'
                            ? 'red'
                            : explanation.status === 'needs_review'
                              ? 'amber'
                              : 'green'
                        }
                      >
                        {explanation.status === 'needs_review'
                          ? 'Не проверено экспертом'
                          : explanation.status === 'verified'
                            ? 'Проверено расчётом'
                            : 'Есть нерешённый вопрос'}
                      </Badge>
                    </div>
                    <ChevronDown className="explanation-chevron" size={18} aria-hidden="true" />
                  </summary>
                  <div className="explanation-body">
                    {snapshot.observations
                      .filter((issue) => issue.element_id === explanation.id)
                      .map((issue) => (
                        <Notice key={issue.id} tone={issue.blocking ? 'error' : 'warning'}>
                          {issue.message}. Исходный статус ниже относится к моменту согласования
                          ревизии; новое наблюдение хранится отдельно.
                        </Notice>
                      ))}
                    <details
                      className={`evidence-block ${explanation.status === 'verified' ? 'calculation' : 'review'}`}
                    >
                      <summary>
                        <span>Основания и расчёт</span>
                        <small>
                          {explanation.status === 'verified' ? 'Подтверждён' : 'Нужна проверка'}
                        </small>
                      </summary>
                      <pre>{displayHours(explanation.detail)}</pre>
                      {explanation.evidence
                        .filter((item) => item.type !== 'assumption')
                        .map((item, i) => (
                          <p key={i}>{displayHours(item.text)}</p>
                        ))}
                    </details>
                    <details className="evidence-block">
                      <summary>
                        <span>Допущения</span>
                        <small>
                          {explanation.evidence.filter((item) => item.type === 'assumption').length
                            ? 'Условия расчёта'
                            : 'Не указаны'}
                        </small>
                      </summary>
                      {explanation.evidence
                        .filter((item) => item.type === 'assumption')
                        .map((item, i) => (
                          <p key={i}>{displayHours(item.text)}</p>
                        ))}
                    </details>
                    {explanation.missing && (
                      <details className="evidence-block review">
                        <summary>
                          <span>Требует уточнения</span>
                          <small>Решение методиста</small>
                        </summary>
                        <p>{explanation.missing}</p>
                      </details>
                    )}
                    {snapshot.observations.filter((issue) => issue.element_id === explanation.id)
                      .length > 0 && (
                      <Form
                        onSubmit={async (event) => {
                          event.preventDefault();
                          const observation = snapshot.observations.find(
                            (issue) =>
                              issue.element_id === explanation.id &&
                              (!selectedIssueId || issue.id === selectedIssueId),
                          );
                          if (!observation) return;
                          try {
                            await command.mutateAsync({
                              action: 'resolve_observation',
                              expected_version: snapshot.course_version,
                              payload: { issue_id: observation.id, correction },
                            });
                            setCorrection('');
                            setSaved(
                              'Исправление сохранено. Программа ожидает отдельного утверждения.',
                            );
                          } catch {
                            /* Keep correction available for retry. */
                          }
                        }}
                      >
                        <Field label="Исправление основания">
                          <textarea
                            className={target === explanation.id ? 'field-highlight' : undefined}
                            value={correction}
                            onChange={(event) => setCorrection(event.target.value)}
                            required
                            rows={3}
                          />
                        </Field>
                        <button disabled={!canEdit || !correction.trim() || command.isPending}>
                          Сохранить исправление
                        </button>
                        <ErrorMessage error={command.error} />
                      </Form>
                    )}
                    <div className="id-links">
                      <small>Перейти к связанным элементам:</small>
                      {explanation.related_ids.map((id) => (
                        <Link
                          key={id}
                          to={
                            id.startsWith('topic') || id === 'calendar'
                              ? `${href('plan')}#${id}`
                              : `${href('map')}#${id}`
                          }
                        >
                          {skeleton.outcomes.find((outcome) => outcome.id === id)?.description
                            ? outcomeText(
                                skeleton.outcomes.find((outcome) => outcome.id === id)!.description,
                              )
                            : skeleton.topics.find((topic) => topic.id === id)?.title ||
                              (id === 'calendar' ? 'Календарь' : id)}
                        </Link>
                      ))}
                    </div>
                  </div>
                </details>
              );
            })}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
function Clarifications({ view }: { view: CourseView }) {
  const form = useForm<Requirements>({
    mode: 'onChange',
    resolver: zodResolver(
      inputSchema.superRefine((values, ctx) => {
        for (const question of view.questions) {
          const value = values[question.field as keyof Requirements];
          if (
            typeof value === 'string' &&
            (!value.trim() || (question.field === 'template_id' && value === 'unknown'))
          )
            ctx.addIssue({
              code: 'custom',
              path: [question.field],
              message:
                question.field === 'template_id'
                  ? 'Выберите тип программы.'
                  : 'Заполните это поле.',
            });
        }
      }),
    ),
    defaultValues: view.requirements,
  });
  const command = useCommand();
  return (
    <Panel
      title={`Уточните ${view.questions.length} параметров`}
      subtitle="Уже известные сведения сохраняются. До ответов каркас и материалы не создаются."
    >
      <Form
        errors={form.formState.errors}
        submitCount={form.formState.submitCount}
        onSubmit={form.handleSubmit((values) =>
          command.mutate({
            action: 'clarify',
            expected_version: view.latest_version,
            payload: values,
          }),
        )}
      >
        {view.questions.map((question) => (
          <Field label={question.label} key={question.field}>
            {question.field === 'template_id' ? (
              <select {...form.register('template_id')} required>
                <option value="unknown" disabled>
                  Выберите тип
                </option>
                <option value="acr_professional">Повышение квалификации</option>
                <option value="acr_general">Общеразвивающая</option>
              </select>
            ) : (
              <input
                {...form.register(question.field as 'total_hours')}
                inputMode={question.field === 'total_hours' ? 'decimal' : undefined}
                required
                placeholder={
                  question.field === 'entry_level'
                    ? 'Например, третий курс ИСиП; основы сетей и Linux'
                    : ''
                }
              />
            )}
          </Field>
        ))}
        <Notice>
          Курс по кибербезопасности даёт начальные навыки; готовность к работе нельзя гарантировать
          только объёмом часов.
        </Notice>
        <ErrorMessage error={command.error} />
        <button className="primary" type="submit" disabled={command.isPending}>
          Сохранить ответы и построить каркас
          <ArrowRight size={17} />
        </button>
      </Form>
    </Panel>
  );
}
