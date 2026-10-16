import { Fragment, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { Snapshot } from '../../entities/course/model/schema';
import { assessmentLabels } from '../../entities/course/model/presets';
import { Badge, Panel } from '../../shared/ui/ui';
import { buildCoverage } from './coverage-model';
import { buildMap, compactMapTitle } from './map-model';
import { MapLinkEditor, type LinkRequest } from './map-link-editor';
import './coverage-matrix.css';

type Filter = 'all' | 'topics' | 'assessment' | 'criteria';
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
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null);
  const rows = buildCoverage(snapshot.skeleton);
  useEffect(() => {
    const row = snapshot.skeleton.outcomes.find((outcome) =>
      snapshot.skeleton.assessments.some(
        (assessment) =>
          assessment.outcome_ids.includes(outcome.id) &&
          location.hash === `#coverage-${outcome.id}-${assessment.id}`,
      ),
    );
    if (row) {
      setExpanded((previous) => (previous.includes(row.id) ? previous : [...previous, row.id]));
      setFilter('all');
      setOnlyGaps(false);
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
  }, [location.hash, expanded, filter, onlyGaps]);
  const summaries: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'Всего результатов', count: rows.length },
    {
      key: 'topics',
      label: 'Без связанных тем',
      count: rows.filter((row) => !row.topics.length).length,
    },
    {
      key: 'assessment',
      label: 'Недостаточно оценочных средств',
      count: rows.filter((row) => row.missingAssessments).length,
    },
    {
      key: 'criteria',
      label: 'Без критериев оценки',
      count: rows.filter((row) => row.missingCriteria).length,
    },
  ];
  const visible = rows.filter(
    (row) =>
      (!onlyGaps || row.gaps.length > 0) &&
      (filter === 'all' ||
        (filter === 'topics' && !row.topics.length) ||
        (filter === 'assessment' && row.missingAssessments) ||
        (filter === 'criteria' && row.missingCriteria)),
  );
  function link(outcomeId: string, target: LinkRequest['target']) {
    const node = buildMap(snapshot.skeleton).nodes.find(
      (node) => node.sourceId === outcomeId && node.column === 1,
    )!;
    setLinkRequest({ node, target });
  }
  return (
    <Panel
      title="Покрытие результатов"
      subtitle="Наличие связей и проверка их соответствия показаны отдельно."
      className="coverage-panel"
    >
      <div id="coverage" className="coverage-summary" aria-label="Сводка покрытия">
        {summaries.map(({ key, label, count }) => (
          <button
            key={key}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key);
              setOnlyGaps(false);
            }}
          >
            <strong>{count}</strong>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <label className="checkbox coverage-filter">
        <input
          type="checkbox"
          checked={onlyGaps}
          onChange={(event) => setOnlyGaps(event.target.checked)}
        />
        Только с пробелами
      </label>
      <p className="coverage-note">
        Для каждого результата нужны минимум два оценочных средства. «Без критериев оценки» —
        критерии отсутствуют или не заполнены у одного из заданий.
      </p>
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
                  <tr className={gaps.length ? 'coverage-gap' : undefined}>
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
                      {gaps.length ? (
                        <ul className="coverage-gaps">
                          {gaps.map((gap) => (
                            <li key={gap}>{gap}</li>
                          ))}
                        </ul>
                      ) : (
                        <Badge tone="green">Связи и критерии заполнены</Badge>
                      )}
                      <Badge tone={row.reviewed ? 'green' : 'amber'}>
                        {row.reviewed
                          ? 'Соответствие проверено методистом'
                          : 'Соответствие требует проверки'}
                      </Badge>
                      {editable && (
                        <div className="coverage-actions">
                          {!topics.length && (
                            <button onClick={() => link(outcome.id, 'topic')}>Связать тему</button>
                          )}
                          {row.missingAssessments && (
                            <button onClick={() => link(outcome.id, 'assessment')}>
                              Добавить проверку
                            </button>
                          )}
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
                        </div>
                      )}
                    </td>
                  </tr>
                  <tr
                    id={`coverage-detail-${outcome.id}`}
                    hidden={!open}
                    className="coverage-detail"
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
                                <button onClick={() => edit(assessment.id)}>Открыть задание</button>
                              )}
                            </div>
                            <dl>
                              <dt>Критерий</dt>
                              <dd className={criterion ? undefined : 'gap-count'}>
                                {criterion || 'Не указан'}
                              </dd>
                            </dl>
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
                          <button onClick={() => link(outcome.id, 'topic')}>Связать тему</button>
                          <button onClick={() => link(outcome.id, 'assessment')}>
                            Добавить проверку
                          </button>
                          <Link
                            to={`/courses/${snapshot.course_id}/map?${new URLSearchParams({ filter: outcome.title || outcome.description })}`}
                          >
                            Проверить соответствие на карте связей
                          </Link>
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
        {!visible.length && <p role="status">По выбранным фильтрам результатов нет.</p>}
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
