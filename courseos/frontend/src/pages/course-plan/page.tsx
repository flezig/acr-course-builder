import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Pencil,
  ListChecks,
  ShieldCheck,
  ChevronDown,
  AlertCircle,
  CheckCircle2,
  Clock3,
} from 'lucide-react';
import { useCommand, useCourse } from '../../entities/course/api/provider';
import { hourTotals, calendarSummary } from '../../entities/course/model/rules';
import { kindLabels } from '../../entities/course/model/presets';
import type { CourseView, Requirements } from '../../entities/course/model/schema';
import { JobPanel } from '../../entities/job/job-panel';
import {
  sumHours,
  hourKinds,
  hourLabels,
  decimalEqual,
  subtractHours,
  formatHours,
  formatSummaryHours,
} from '../../shared/lib/decimal';
import {
  Badge,
  Empty,
  ErrorMessage,
  Field,
  Loading,
  Notice,
  Panel,
  statuses,
} from '../../shared/ui/ui';
import { ReviewWorkspace } from './review-workspace';
import { CalendarPanel } from './calendar-panel';
import { SkeletonEditor } from './skeleton-editor';
import { IntentBlockEditor, type IntentBlock } from './intent-block-editor';
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
export function remarkCount(count: number) {
  const form = new Intl.PluralRules('ru').select(count);
  return `${count} ${form === 'one' ? 'замечание' : form === 'few' ? 'замечания' : 'замечаний'}`;
}
export function PlanPage() {
  const query = useCourse();
  const location = useLocation();
  const navigate = useNavigate();
  const command = useCommand();
  const [editing, setEditing] = useState(false);
  const [blockEditing, setBlockEditing] = useState<IntentBlock | null>(null);
  const [saved, setSaved] = useState('');
  const [correction, setCorrection] = useState('');
  const [approveConfirmed, setApproveConfirmed] = useState(false);
  const hash = decodeURIComponent(location.hash.slice(1));
  const snapshot = query.data?.snapshot;
  const [target, selectedIssueId] = hash.replace(/^fix-/, '').split('~');
  const tab =
    target === 'review' || target.startsWith('issue-')
      ? 'review'
      : target === 'calendar'
        ? 'calendar'
        : target === 'curriculum' || target.startsWith('topic-')
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
      const section = ['intent', 'curriculum', 'calendar', 'review'].includes(hash);
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
  const totals = hourTotals(skeleton);
  const sharedDepth =
    skeleton.outcomes.length > 0 &&
    skeleton.outcomes.every((outcome) => outcome.depth === skeleton.outcomes[0].depth)
      ? skeleton.outcomes[0].depth
      : null;
  const explainsSolution = skeleton.outcomes.some((outcome) =>
    outcome.description.endsWith('и объясняет решение'),
  );
  const issues = snapshot.audit.issues;
  const blocking = issues.filter((issue) => issue.blocking);
  const active = ['queued', 'running'].includes(view.job.status);
  const readonly = !view.is_latest || active;
  const canEdit = !readonly && !editing && !blockEditing;
  const versionQuery = view.is_latest ? '' : `?version=${snapshot.course_version}`;
  const href = (page: string) => `/courses/${view.course_id}/${page}${versionQuery}`;
  const state = snapshot.approval_applicable
    ? 'Программа утверждена'
    : blocking.length
      ? 'Нужны исправления'
      : 'Ожидает проверки методиста';
  const issuePlace = (id: string) =>
    id === 'calendar'
      ? 'Календарь · параметры нагрузки'
      : skeleton.topics.find((topic) => topic.id === id)?.title
        ? `Учебный план · ${skeleton.topics.find((topic) => topic.id === id)!.title}`
        : skeleton.outcomes.find((outcome) => outcome.id === id)?.description
          ? `О программе · ${outcomeText(skeleton.outcomes.find((outcome) => outcome.id === id)!.description)}`
          : skeleton.explanations.find((explanation) => explanation.id === id)?.title ||
            'Проверка программы';
  const issueHref = (id: string, issueId: string) =>
    id === 'calendar' ||
    skeleton.topics.some((topic) => topic.id === id) ||
    skeleton.outcomes.some((outcome) => outcome.id === id) ||
    skeleton.explanations.some((explanation) => explanation.id === id)
      ? `${href('plan')}#fix-${id}${snapshot.observations.some((issue) => issue.id === issueId) ? `~${issueId}` : ''}`
      : `${href('audit')}#issue-${issues.find((issue) => issue.element_id === id)?.id || ''}`;
  const editButton = (block: IntentBlock, label: string) => (
    <button
      className="block-edit"
      disabled={!canEdit || (block === 'outcomes' && !skeleton.outcomes.length)}
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
            {blocking.length > 0 && !snapshot.approval_applicable ? (
              <Link className="program-status badge amber" to={`#issue-${blocking[0].id}`}>
                <Clock3 size={12} aria-hidden="true" />
                {state}
              </Link>
            ) : (
              <Badge tone={snapshot.approval_applicable ? 'green' : 'neutral'}>
                {snapshot.approval_applicable ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}
                {state}
              </Badge>
            )}
          </div>
        </div>
        <button
          className="secondary edit-skeleton"
          onClick={() => {
            setEditing(!editing);
            setSaved('');
          }}
          disabled={readonly || !!blockEditing}
        >
          <Pencil size={15} />
          {editing ? 'Редактор открыт' : 'Редактировать программу'}
        </button>
      </header>
      <nav className="plan-nav" aria-label="Разделы программы">
        {(
          [
            ['intent', 'О программе'],
            ['curriculum', 'Учебный план'],
            ['calendar', 'Календарь'],
            ['review', 'Проверка и утверждение'],
          ] as const
        ).map(([id, title]) => (
          <Link
            key={id}
            to={`#${id}`}
            aria-label={title}
            aria-describedby={
              id === 'review' && blocking.length > 0 ? 'review-remark-count' : undefined
            }
            aria-current={tab === id ? 'page' : undefined}
          >
            {title}
            {id === 'review' && blocking.length > 0 && (
              <span
                id="review-remark-count"
                className="tab-count"
                aria-label={remarkCount(blocking.length)}
              >
                {blocking.length}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <div className="plan-metrics" aria-label="Показатели программы" hidden={tab === 'review'}>
        <div>
          <small>Объём программы</small>
          <strong>
            {formatSummaryHours(skeleton.requirements.total_hours)}
            <span> уч. ч.</span>
          </strong>
        </div>
        <div>
          <small>Практика и самостоятельная работа</small>
          <strong>
            {formatSummaryHours(sumHours([totals.practice, totals.lab, totals.self_study]))}
            <span> уч. ч.</span>
          </strong>
        </div>
        <div>
          <small>Результаты обучения</small>
          <strong>{skeleton.outcomes.length}</strong>
        </div>
      </div>
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
            focusTarget={target}
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
                    {explainsSolution && (
                      <p className="outcome-intro">
                        При демонстрации каждого результата слушатель объясняет своё решение.
                      </p>
                    )}
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
              <details className="intent-tasks">
                <summary>
                  Задачи программы <span>{skeleton.tasks.length}</span>
                </summary>
                <ul className="task-list">
                  {skeleton.tasks.map((task) => (
                    <li key={task}>{task}</li>
                  ))}
                </ul>
              </details>
            </Panel>
          </div>
          <div id="curriculum" hidden={tab !== 'curriculum'}>
            <div className="section-toolbar">
              <span>
                {new Set(skeleton.topics.map((topic) => topic.module_id)).size} модулей ·{' '}
                {skeleton.topics.length} тем
              </span>
              <button className="block-edit" disabled={!canEdit} onClick={() => setEditing(true)}>
                <Pencil size={14} />
                Изменить план
              </button>
            </div>
            <Panel
              title="Учебный план"
              subtitle="Часы по темам и видам работы"
              className="curriculum-panel"
            >
              <details className="plan-calculations">
                <summary>Подробные расчёты часов</summary>
                <p>
                  {formatHours(subtractHours(sumHours(Object.values(totals)), totals.assessment))}{' '}
                  обучение + {formatHours(totals.assessment)} аттестация ={' '}
                  {formatHours(sumHours(Object.values(totals)))} всего
                </p>
                <div className="calculation-content">
                  <p>
                    Часы каждого вида работы суммируются по всем модулям. Доля рассчитана от полного
                    объёма программы, включая аттестацию.
                  </p>
                  <p>
                    Практика, лабораторные и самостоятельная работа:{' '}
                    {formatHours(sumHours([totals.practice, totals.lab, totals.self_study]))} уч. ч.
                  </p>
                  <dl className="calculation-breakdown">
                    {hourKinds.map((kind) => {
                      const values = Array.from(new Set(skeleton.topics.map((t) => t.module_id)))
                        .map((id) =>
                          sumHours(
                            skeleton.topics
                              .filter((t) => t.module_id === id)
                              .map((t) => t.hours[kind]),
                          ),
                        )
                        .filter((value) => !decimalEqual(value, '0'));
                      const groups = new Map<string, number>();
                      values.forEach((value) => groups.set(value, (groups.get(value) || 0) + 1));
                      const formula = Array.from(groups, ([value, count]) =>
                        count > 1 ? `${count} × ${formatHours(value)}` : formatHours(value),
                      ).join(' + ');
                      const total = sumHours(Object.values(totals));
                      const share = decimalEqual(total, '0')
                        ? '0'
                        : new Decimal(totals[kind])
                            .div(total)
                            .times(100)
                            .toDecimalPlaces(1)
                            .toString();
                      return (
                        <div key={kind}>
                          <dt>
                            {kind === 'self_study' ? 'Самостоятельная работа' : hourLabels[kind]}
                          </dt>
                          <dd>
                            <strong>{formatHours(totals[kind])} уч. ч.</strong>
                            <span>{formatHours(share)}% объёма</span>
                            <small>
                              {values.length
                                ? `${formula} = ${formatHours(totals[kind])} уч. ч. · сумма по модулям`
                                : 'В учебном плане не предусмотрены'}
                            </small>
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  <div
                    className={`calculation-check ${decimalEqual(sumHours(Object.values(totals)), skeleton.requirements.total_hours) ? 'is-balanced' : 'is-unbalanced'}`}
                    role="status"
                  >
                    <strong>
                      {decimalEqual(
                        sumHours(Object.values(totals)),
                        skeleton.requirements.total_hours,
                      )
                        ? 'Объём совпадает с запросом'
                        : 'Объём отличается от запроса'}
                    </strong>
                    <span>
                      По плану: {formatHours(sumHours(Object.values(totals)))} уч. ч. · В запросе:{' '}
                      {formatHours(skeleton.requirements.total_hours)} уч. ч. · Разница (план −
                      запрос):{' '}
                      {formatHours(
                        subtractHours(
                          sumHours(Object.values(totals)),
                          skeleton.requirements.total_hours,
                        ),
                      )}{' '}
                      уч. ч.
                    </span>
                  </div>
                  <p>
                    «Всего» в строке модуля — сумма всех видов работы; «Итого» — сумма по всем
                    модулям. Аттестация уже включена в общий объём.
                  </p>
                  <p>
                    Дробные значения — доли учебного часа: 1,7 уч. ч. — это 1,7 учебного часа, а не
                    1 час 70 минут. Продолжительность учебного часа в минутах требует уточнения.
                  </p>
                </div>
              </details>
              <p className="scroll-hint">
                Прокрутите таблицу по горизонтали, чтобы увидеть все виды работы →
              </p>
              <div
                className="table-scroll plan-table"
                tabIndex={0}
                role="region"
                aria-label="Учебный план: все столбцы доступны при горизонтальной прокрутке"
              >
                <table>
                  <colgroup>
                    <col className="topic-column" />
                    {Array.from({ length: 6 }, (_, i) => (
                      <col key={i} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Модуль / тема</th>
                      {hourKinds.map((kind) => (
                        <th key={kind}>
                          {kind === 'self_study'
                            ? 'Самостоя\u00adтельная'
                            : kind === 'lab'
                              ? 'Лабора\u00adторные'
                              : hourLabels[kind]}
                        </th>
                      ))}
                      <th>Всего</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(new Set(skeleton.topics.map((t) => t.module_id))).map(
                      (moduleId) => (
                        <ModuleRows
                          key={moduleId}
                          moduleId={moduleId}
                          focused={target}
                          allTopics={skeleton.topics}
                          topics={skeleton.topics.filter((t) => t.module_id === moduleId)}
                        />
                      ),
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Итого</th>
                      {hourKinds.map((kind) => (
                        <HourCell key={kind} value={totals[kind]} />
                      ))}
                      <HourCell value={sumHours(Object.values(totals))} />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="table-note">
                Все значения — в учебных часах. Аттестация включена в столбец «Всего»; повторно
                прибавлять её не нужно.
              </p>
              <Link className="text-link" to={href('map')}>
                <ListChecks size={16} />
                Открыть связи результатов, тем и оценивания <ArrowRight size={16} />
              </Link>
            </Panel>
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
              approval={
                <>
                  <Panel title="Утверждение программы" className="approval-panel">
                    <p>
                      Утверждается ревизия <b>{snapshot.skeleton_version}</b> с её основаниями и
                      решениями.
                    </p>
                    {blocking.length > 0 ? (
                      <p className="approval-blocked">
                        <AlertCircle size={16} />
                        Утверждение недоступно. Исправьте {remarkCount(blocking.length)}.
                        <Link to={`#issue-${blocking[0].id}`}>Разобрать замечание</Link>
                      </p>
                    ) : !snapshot.approval_applicable ? (
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={approveConfirmed}
                          onChange={(event) => setApproveConfirmed(event.target.checked)}
                        />
                        Я проверил цель, результаты, часы, оценивание и основания. Утверждаю эту
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
                        blocking.length > 0 ||
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
                    {snapshot.approval_applicable && snapshot.materials.length > 0 && (
                      <Link className="button secondary" to={href('materials')}>
                        Проверить материалы <ArrowRight size={16} />
                      </Link>
                    )}
                    {editing && <small>Сначала сохраните или закройте редактор.</small>}
                    <ErrorMessage error={command.error} />
                    <Link className="text-link" to={href('audit')}>
                      Отчёт проверки программы
                    </Link>
                    <details>
                      <summary>Сведения о ревизии и утверждении</summary>
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
                      <small className="check-origin">
                        {explanation.status === 'needs_review'
                          ? 'Оценка методиста'
                          : 'Автоматическая проверка'}
                      </small>
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
                          ? 'Требует оценки методиста'
                          : explanation.category === 'hours' &&
                              explanation.status === 'verified' &&
                              decimalEqual(
                                sumHours(Object.values(totals)),
                                skeleton.requirements.total_hours,
                              )
                            ? 'Расчёт проверен'
                            : explanation.category === 'assessment' &&
                                explanation.status === 'verified'
                              ? 'Способы проверки предусмотрены'
                              : statuses[explanation.status]}
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
                      <form
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
                      </form>
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
function HourCell({ value }: { value: string }) {
  return (
    <td className={decimalEqual(value, '0') ? 'zero-hours' : undefined}>{formatHours(value)}</td>
  );
}
function ModuleRows({
  moduleId,
  topics,
  allTopics,
  focused,
}: {
  moduleId: string;
  focused?: string;
  allTopics: import('../../entities/course/model/schema').Topic[];
  topics: import('../../entities/course/model/schema').Topic[];
}) {
  const moduleLabel =
    moduleId === 'module-final'
      ? 'Итоговая аттестация'
      : `Модуль ${moduleId.replace('module-', '')}`;
  return (
    <>
      {topics.map((topic) => (
        <tr
          key={topic.id}
          id={topic.id}
          className={focused === topic.id ? 'field-highlight' : undefined}
        >
          <th scope="row">
            <details className="topic-details">
              <summary>
                <ChevronDown size={16} aria-hidden="true" />
                <span>
                  <small>{moduleLabel !== topic.title ? moduleLabel : null}</small>
                  <span>{topic.title}</span>
                </span>
              </summary>
              <div className="topic-content">
                <p>{topic.content}</p>
                <p>
                  Предпосылки:{' '}
                  {topic.prerequisite_ids
                    .map(
                      (id) => allTopics.find((item) => item.id === id)?.title || 'Связанная тема',
                    )
                    .join(', ') || 'Входной уровень'}
                </p>
                <p>
                  {topic.delivery} · {topic.control}
                </p>
              </div>
            </details>
          </th>
          {hourKinds.map((kind) => (
            <HourCell key={kind} value={topic.hours[kind]} />
          ))}
          <HourCell value={sumHours(Object.values(topic.hours))} />
        </tr>
      ))}
      {topics.length > 1 && (
        <tr className="subtotal">
          <th scope="row">Итого по модулю</th>
          {hourKinds.map((kind) => (
            <HourCell key={kind} value={sumHours(topics.map((topic) => topic.hours[kind]))} />
          ))}
          <HourCell value={sumHours(topics.flatMap((topic) => Object.values(topic.hours)))} />
        </tr>
      )}
    </>
  );
}
function Clarifications({ view }: { view: CourseView }) {
  const form = useForm<Requirements>({ defaultValues: view.requirements });
  const command = useCommand();
  return (
    <Panel
      title={`Уточните ${view.questions.length} параметров`}
      subtitle="Уже известные сведения сохраняются. До ответов каркас и материалы не создаются."
    >
      <form
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
                <option value="unknown">Выберите тип</option>
                <option value="acr_professional">Повышение квалификации</option>
                <option value="acr_general">Общеразвивающая</option>
              </select>
            ) : (
              <input
                {...form.register(question.field as 'total_hours')}
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
      </form>
    </Panel>
  );
}
