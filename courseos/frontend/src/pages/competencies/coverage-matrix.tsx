import { Fragment, useEffect, useState } from 'react';
import { ArrowUpRight, Check, CircleAlert, CircleCheck, Clock3, ChevronDown } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { Snapshot } from '../../entities/course/model/schema';
import { assessmentLabels } from '../../entities/course/model/presets';
import { Panel } from '../../shared/ui/ui';
import { plural } from '../../shared/lib/plural';
import { buildCoverage } from './coverage-model';
import { buildMap, compactMapTitle } from './map-model';
import { MapLinkEditor, type LinkRequest } from './map-link-editor';
import './coverage-matrix.css';

type Filter = 'all' | 'gaps' | 'topics' | 'assessment' | 'criteria';
export function CoverageMatrix({
  snapshot,
  planHref,
  editable,
  edit,
}: {
  snapshot: Snapshot;
  planHref: string;
  editable: boolean;
  edit: (target: string) => void;
}) {
  const location = useLocation();
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null);
  const rows = buildCoverage(snapshot.skeleton);
  useEffect(() => {
    const row = snapshot.skeleton.outcomes.find(
      (outcome) =>
        location.hash === `#coverage-detail-${outcome.id}` ||
        snapshot.skeleton.assessments.some(
          (assessment) =>
            assessment.outcome_ids.includes(outcome.id) &&
            location.hash === `#coverage-${outcome.id}-${assessment.id}`,
        ),
    );
    if (row) {
      setExpanded((previous) => (previous.includes(row.id) ? previous : [...previous, row.id]));
      setFilter('all');
    }
  }, [location.hash, snapshot.skeleton]);
  useEffect(() => {
    if (!location.hash.startsWith('#coverage-')) return;
    const frame = requestAnimationFrame(() => {
      const assignment = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (!assignment || assignment.closest('[hidden]')) return;
      assignment.scrollIntoView({ block: 'center' });
      assignment.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash, expanded, filter]);
  const gapCount = rows.filter((row) => row.gaps.length > 0).length;
  const summaries: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'Все', count: rows.length },
    { key: 'gaps', label: 'С пробелами', count: gapCount },
    {
      key: 'topics',
      label: 'Без тем',
      count: rows.filter((row) => !row.topics.length).length,
    },
    {
      key: 'assessment',
      label: 'Недостаточно оценивания',
      count: rows.filter((row) => row.missingAssessments).length,
    },
    {
      key: 'criteria',
      label: 'Без критериев',
      count: rows.filter((row) => row.missingCriteria).length,
    },
  ];
  const visible = rows.filter(
    (row) =>
      filter === 'all' ||
      (filter === 'gaps' && row.gaps.length > 0) ||
      (filter === 'topics' && !row.topics.length) ||
      (filter === 'assessment' && row.missingAssessments) ||
      (filter === 'criteria' && row.missingCriteria),
  );
  function link(outcomeId: string, target: LinkRequest['target']) {
    const node = buildMap(snapshot.skeleton).nodes.find(
      (node) => node.sourceId === outcomeId && node.column === 1,
    )!;
    setLinkRequest({ node, target });
  }
  function reviewHref(outcomeId: string) {
    const search = new URLSearchParams(planHref.split('?')[1]);
    search.set('outcome', outcomeId);
    return `/courses/${snapshot.course_id}/map?${search}`;
  }
  return (
    <Panel className="coverage-panel">
      <div id="coverage" className="coverage-toolbar">
        <div className="coverage-heading">
          <h2>
            Покрытие результатов
            <span className="coverage-total">
              · {rows.length} {plural(rows.length, ['результат', 'результата', 'результатов'])}
            </span>
          </h2>
          <details className="coverage-help">
            <summary aria-label="Справка о покрытии результатов">ⓘ</summary>
            <div className="coverage-help-content">
              <p>
                Для каждого результата нужны минимум два оценочных средства. «Без критериев» —
                критерии отсутствуют или не заполнены у одного из заданий.
              </p>
              <p>
                «С пробелами» показывает результаты с любыми замечаниями. Категории могут
                пересекаться; каждый результат в общем счётчике учитывается один раз.
              </p>
              <p>
                Заполненные связи и критерии не означают, что методист проверил их соответствие.
                Статус проверки показан отдельно в таблице.
              </p>
            </div>
          </details>
        </div>
        <div className="coverage-summary" role="group" aria-label="Фильтры покрытия">
          {summaries.map(({ key, label, count }) => (
            <button
              type="button"
              key={key}
              className={key === 'topics' ? 'coverage-category-start' : undefined}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              <span>{label}</span>
              <span className={`coverage-count${key !== 'all' && count > 0 ? ' has-gaps' : ''}`}>
                {count}
              </span>
            </button>
          ))}
        </div>
        {rows.length > 0 && gapCount === 0 && (
          <p className="coverage-complete-note coverage-summary-complete">
            <Check size={14} aria-hidden="true" />
            Связи и критерии заполнены
          </p>
        )}
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Покрытие результатов">
        <table className="coverage-matrix">
          <thead>
            <tr>
              <th>Результат обучения</th>
              <th>Где формируется</th>
              <th>Статус и замечания</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const { outcome, topics, activities, assessments, gaps } = row;
              const open = expanded.includes(outcome.id);
              return (
                <Fragment key={outcome.id}>
                  <tr>
                    <th scope="row">
                      <strong>{outcome.title || compactMapTitle(outcome.description)}</strong>
                      <button
                        className="coverage-disclosure"
                        aria-expanded={open}
                        aria-controls={`coverage-detail-${outcome.id}`}
                        onClick={() =>
                          setExpanded(
                            open
                              ? expanded.filter((id) => id !== outcome.id)
                              : [...expanded, outcome.id],
                          )
                        }
                      >
                        {open ? 'Скрыть элементы контроля' : 'Элементы контроля'}
                      </button>
                    </th>
                    <td data-label="Где формируется">
                      {topics.length ? (
                        topics.map((topic) => (
                          <Link
                            className="coverage-item"
                            key={topic.id}
                            to={`${planHref}#${topic.id}`}
                          >
                            {topic.title}
                          </Link>
                        ))
                      ) : (
                        <span>Нет связанных тем</span>
                      )}
                      {activities.length > 0 && (
                        <details className="coverage-practice">
                          <summary>
                            Учебная практика
                            <span className="coverage-practice-count">{activities.length}</span>
                            <ChevronDown size={16} aria-hidden="true" />
                          </summary>
                          <ol className="coverage-practice-list">
                            {activities.map((activity) => (
                              <li key={activity.id}>
                                <strong>
                                  {snapshot.skeleton.topics.find(
                                    (topic) => topic.id === activity.topic_id,
                                  )?.title || 'Учебная активность'}
                                </strong>
                                <p>{activity.description || 'Описание активности не указано'}</p>
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </td>
                    <td data-label="Статус и замечания">
                      <div className="coverage-status-line">
                        <span
                          className={`coverage-status ${gaps.length ? 'needs-work' : row.reviewed ? 'verified' : 'pending'}`}
                        >
                          {gaps.length ? (
                            <CircleAlert size={14} aria-hidden="true" />
                          ) : row.reviewed ? (
                            <CircleCheck size={14} aria-hidden="true" />
                          ) : (
                            <Clock3 size={14} aria-hidden="true" />
                          )}
                          {gaps.length
                            ? 'Нужно дополнить'
                            : row.reviewed
                              ? 'Проверено методистом'
                              : 'Ожидает проверки'}
                        </span>
                        {(gaps.length > 0 || !row.reviewed) && (
                          <Link
                            className="coverage-status-action"
                            to={
                              gaps.length
                                ? `${planHref}#coverage-detail-${outcome.id}`
                                : reviewHref(outcome.id)
                            }
                          >
                            {editable ? (gaps.length ? 'Исправить' : 'Проверить') : 'Посмотреть'}
                            <ArrowUpRight size={14} aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                      {gaps.length ? (
                        <>
                          <ul className="coverage-gaps">
                            {gaps.map((gap) => (
                              <li key={gap}>{gap}</li>
                            ))}
                          </ul>
                          <p className="coverage-review-note">
                            {row.reviewed
                              ? 'Соответствие проверено методистом'
                              : 'Методист ещё не проверил'}
                          </p>
                        </>
                      ) : (
                        <p className="coverage-complete-note">
                          <Check size={14} aria-hidden="true" />
                          Связи и критерии заполнены
                        </p>
                      )}
                    </td>
                  </tr>
                  <tr
                    id={`coverage-detail-${outcome.id}`}
                    hidden={!open}
                    className="coverage-detail"
                    tabIndex={-1}
                  >
                    <td colSpan={3}>
                      <p className="coverage-outcome-text">{outcome.description}</p>
                      <h3>Как проверяется</h3>
                      {!assessments.length && (
                        <p className="gap-count">
                          Нет проверочного задания. Темы:{' '}
                          {topics.map((topic) => topic.title).join(', ') || 'не связаны'}.
                        </p>
                      )}
                      {assessments.map((assessment) => {
                        const topic = snapshot.skeleton.topics.find(
                          (topic) => topic.id === assessment.topic_id,
                        );
                        const criterion = assessment.criterion.trim();
                        return (
                          <section
                            key={assessment.id}
                            id={`coverage-${outcome.id}-${assessment.id}`}
                            className="coverage-chain"
                            tabIndex={-1}
                          >
                            <div className="coverage-chain-head">
                              <strong>
                                {assessmentLabels[assessment.type]}
                                {topic ? ` по теме «${topic.title}»` : ''}
                              </strong>
                              {editable && (
                                <button className="link-button" onClick={() => edit(assessment.id)}>
                                  Открыть
                                </button>
                              )}
                            </div>
                            {criterion ? (
                              <ul className="coverage-criteria">
                                {criterion
                                  .split(';')
                                  .map((part) => part.trim().replace(/\.$/, ''))
                                  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                                  .filter(Boolean)
                                  .map((part) => (
                                    <li key={part}>{part}</li>
                                  ))}
                              </ul>
                            ) : (
                              <p className="gap-count">Критерий не указан</p>
                            )}
                            {topic && !topic.outcome_ids.includes(outcome.id) && (
                              <p className="gap-count">
                                Тема задания не связана с этим результатом.
                              </p>
                            )}
                            {assessment.outcome_ids.length > 1 && (
                              <p className="coverage-chain-note">
                                Задание общее для нескольких результатов — критерий относится ко
                                всему заданию.
                              </p>
                            )}
                          </section>
                        );
                      })}
                      {editable && (
                        <div className="coverage-actions">
                          {row.missingCriteria && (
                            <button
                              onClick={() =>
                                edit(
                                  assessments.find((assessment) => !assessment.criterion.trim())
                                    ?.id || outcome.id,
                                )
                              }
                            >
                              Указать критерии
                            </button>
                          )}
                          <button className="link-button" onClick={() => link(outcome.id, 'topic')}>
                            Связать тему
                          </button>
                          <button
                            className="link-button"
                            onClick={() => link(outcome.id, 'assessment')}
                          >
                            Добавить проверку
                          </button>
                          <Link to={reviewHref(outcome.id)}>Открыть на карте связей</Link>
                        </div>
                      )}
                      {!editable && <p>Версия доступна только для просмотра.</p>}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!visible.length && (
          <p role="status">
            {rows.length
              ? 'По выбранному фильтру результатов нет.'
              : 'Результатов обучения пока нет.'}
          </p>
        )}
      </div>
      {linkRequest && (
        <MapLinkEditor
          snapshot={snapshot}
          request={linkRequest}
          close={() => setLinkRequest(null)}
          edit={() => {
            const id = linkRequest.node.sourceId;
            setLinkRequest(null);
            edit(id);
          }}
        />
      )}
    </Panel>
  );
}
