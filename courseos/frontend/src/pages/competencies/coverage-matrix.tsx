import { Fragment, useEffect, useState } from 'react';
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
  const summaries: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'Всего результатов', count: rows.length },
    {
      key: 'topics',
      label: 'Без связанных тем',
      count: rows.filter((row) => !row.topics.length).length,
    },
    {
      key: 'assessment',
      label: 'Без проверки',
      count: rows.filter((row) => !row.assessments.length).length,
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
        (filter === 'assessment' && !row.assessments.length) ||
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
        «Без проверки» — нет связанного задания. «Без критериев оценки» — критерии отсутствуют или
        не заполнены у одного из заданий. Фильтр пробелов показывает отсутствующие связи и
        детализацию.
      </p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Покрытие результатов">
        <table className="coverage-matrix">
          <thead>
            <tr>
              <th>Результат обучения</th>
              <th>Где формируется</th>
              <th>Как проверяется</th>
              <th>Критерии достижения</th>
              <th>Пробелы</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const { outcome, topics, activities, assessments, criteria, gaps } = row;
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
                        {open ? 'Скрыть цепочку' : 'Формулировка и цепочка'}
                      </button>
                    </th>
                    <td>
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
                        <details>
                          <summary>Учебная активность / практика · {activities.length}</summary>
                          {activities.map((activity) => (
                            <p key={activity.id}>
                              {activity.description || 'Описание активности не указано'}
                            </p>
                          ))}
                        </details>
                      )}
                    </td>
                    <td>
                      <strong>
                        {assessments.length
                          ? `Связано ${assessments.length} ${assessments.length % 100 >= 11 && assessments.length % 100 <= 14 ? 'заданий' : assessments.length % 10 === 1 ? 'задание' : assessments.length % 10 >= 2 && assessments.length % 10 <= 4 ? 'задания' : 'заданий'}`
                          : 'Нет проверочного задания'}
                      </strong>
                      {assessments.map((assessment) => (
                        <a
                          className="coverage-item"
                          key={assessment.id}
                          href={`#coverage-${outcome.id}-${assessment.id}`}
                          onClick={() => {
                            if (!open) setExpanded([...expanded, outcome.id]);
                          }}
                        >
                          <small>{assessmentLabels[assessment.type]}</small>
                          {assessment.action.trim() || 'Формулировка задания не указана'}
                        </a>
                      ))}
                    </td>
                    <td>
                      {criteria.length ? (
                        <details>
                          <summary className="coverage-criterion">{criteria[0]}</summary>
                          {criteria.map((criterion) => (
                            <p key={criterion}>{criterion}</p>
                          ))}
                          <small>
                            Критерии результата и связанных заданий; соответствие проверяется
                            отдельно.
                          </small>
                        </details>
                      ) : (
                        'Не указаны критерии'
                      )}
                      {row.missingCriteria && criteria.length > 0 && (
                        <span className="gap-count">Не у всех заданий указан критерий</span>
                      )}
                    </td>
                    <td>
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
                          {!assessments.length && (
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
                    <td colSpan={5}>
                      <p>
                        <strong>Результат:</strong> {outcome.description}
                      </p>
                      <h3>Результат → тема → задание → критерий</h3>
                      {!assessments.length && (
                        <p>
                          {topics.map((topic) => topic.title).join(', ') || 'Нет связанных тем'} →
                          Нет проверочного задания → Критерий задания отсутствует
                        </p>
                      )}
                      {assessments.map((assessment) => {
                        const topic = snapshot.skeleton.topics.find(
                          (topic) => topic.id === assessment.topic_id,
                        );
                        return (
                          <section
                            key={assessment.id}
                            id={`coverage-${outcome.id}-${assessment.id}`}
                            className="coverage-chain"
                            tabIndex={-1}
                          >
                            <p>
                              {outcome.title || compactMapTitle(outcome.description)} →{' '}
                              {topic ? (
                                <Link to={`${planHref}#${topic.id}`}>{topic.title}</Link>
                              ) : (
                                'Тема задания отсутствует'
                              )}{' '}
                              →{' '}
                              <strong>
                                {assessment.action || 'Формулировка задания не указана'}
                              </strong>{' '}
                              ({assessmentLabels[assessment.type]}) →{' '}
                              {assessment.criterion.trim() || 'Не указаны критерии'}
                            </p>
                            {topic && !topic.outcome_ids.includes(outcome.id) && (
                              <p className="gap-count">
                                Тема задания не связана с этим результатом.
                              </p>
                            )}
                            {assessment.outcome_ids.length > 1 && (
                              <p className="gap-count">
                                Общее задание для нескольких результатов. Часть задания и критерий
                                для выбранного результата отдельно не указаны. Критерий выше
                                относится ко всему заданию. Для детализации нужны новые поля модели
                                и поддержка сохранения.
                              </p>
                            )}
                            {editable && (
                              <button onClick={() => edit(assessment.id)}>Открыть задание</button>
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
                      {!editable && (
                        <p>
                          Ревизия доступна только для просмотра. Задания и критерии показаны выше.
                        </p>
                      )}
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
