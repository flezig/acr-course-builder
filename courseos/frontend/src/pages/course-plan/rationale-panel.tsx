import { useMemo, useState } from 'react';
import { ArrowLeft, Download, Search, X } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import {
  currentRationales,
  rationaleCoverage,
  rationaleIsSupported,
  rationaleSignature,
  skeletonElements,
  sourceById,
  skeletonRationaleMarkdown,
} from '../../entities/course/model/rationale';
import { saveFile } from '../../shared/lib/use-unsaved';
import { Badge, Panel } from '../../shared/ui/ui';
import {
  basisLabels,
  elementDecision,
  elementName,
  rationaleGroup,
  rationaleGroups,
  rationaleSummary,
  readableRationaleText,
  statusLabels,
  type RationaleGroup,
} from './rationale-presentation';
import './rationale-panel.css';

export function RationalePanel({ snapshot }: { snapshot: Snapshot }) {
  return <RationaleBrowser key={snapshot.course_id} snapshot={snapshot} />;
}

function RationaleBrowser({ snapshot }: { snapshot: Snapshot }) {
  const s = snapshot.skeleton;
  const [group, setGroup] = useState<RationaleGroup | 'all'>('intent');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('goal');
  const [showDetail, setShowDetail] = useState(false);
  const coverage = useMemo(() => rationaleCoverage(s), [s]);
  const signature = useMemo(() => rationaleSignature(s), [s]);
  const items = useMemo(
    () =>
      skeletonElements(s).map((element) => {
        const records = currentRationales(s, element.id, signature);
        return {
          element,
          records,
          name: elementName(s, element),
          decision: elementDecision(s, element),
          group: rationaleGroup(s, element.id),
          summary: rationaleSummary(s, element, records, signature),
        };
      }),
    [s, signature],
  );
  const search = query.trim().toLocaleLowerCase('ru');
  const filtered = items.filter(
    (item) =>
      (group === 'all' || item.group === group) &&
      (!search ||
        `${item.name} ${item.decision} ${item.summary.why}`
          .toLocaleLowerCase('ru')
          .includes(search)),
  );
  const selected = filtered.find((item) => item.element.id === selectedId) || filtered[0];
  const changeGroup = (value: typeof group) => {
    setShowDetail(false);
    setGroup(value);
    setSelectedId('');
  };
  const readable = (value: string) => readableRationaleText(s, value);

  return (
    <Panel title="Почему курс устроен так" className="rationale-panel">
      <div className="rationale-overview">
        <p>
          <strong>{coverage.confirmed + coverage.expert}</strong> с подтверждением
          <span aria-hidden="true"> · </span>
          <strong>{coverage.assumptions + coverage.gaps}</strong> требуют обсуждения
        </p>
        <button
          className="rationale-download"
          onClick={() =>
            saveFile(
              new Blob([skeletonRationaleMarkdown(snapshot)], {
                type: 'text/markdown;charset=utf-8',
              }),
              `${snapshot.course_id}-v${snapshot.course_version}-rationale.md`,
            )
          }
        >
          <Download size={15} aria-hidden="true" /> Скачать пояснения · MD
        </button>
      </div>
      <nav className="rationale-groups" aria-label="Разделы пояснений">
        {rationaleGroups.map((item) => (
          <button
            key={item.id}
            aria-pressed={group === item.id}
            onClick={() => changeGroup(item.id)}
          >
            {item.title}
          </button>
        ))}
      </nav>
      <div className="rationale-filters">
        <label className="rationale-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Найти пояснение"
            placeholder="Найти тему, задание или решение"
            value={query}
            onChange={(event) => {
              setShowDetail(false);
              setQuery(event.target.value);
              setGroup('all');
              setSelectedId('');
            }}
          />
          {query && (
            <button aria-label="Очистить поиск пояснений" onClick={() => setQuery('')}>
              <X size={15} />
            </button>
          )}
        </label>
      </div>
      {group === 'all' && (
        <div className="rationale-search-scope">
          Поиск по всем разделам{' '}
          <button
            onClick={() => {
              setQuery('');
              changeGroup('intent');
            }}
          >
            Вернуться к разделам
          </button>
        </div>
      )}
      {selected ? (
        <>
          <div className={`rationale-browser-layout ${showDetail ? 'show-detail' : ''}`}>
            <nav className="rationale-decision-list" aria-label="Список решений">
              {filtered.map((item) => (
                <button
                  key={item.element.id}
                  data-decision-id={item.element.id}
                  aria-current={selected.element.id === item.element.id ? 'true' : undefined}
                  onClick={() => {
                    setSelectedId(item.element.id);
                    setShowDetail(true);
                    requestAnimationFrame(() =>
                      document.getElementById(`basis-${item.element.id}`)?.focus(),
                    );
                  }}
                >
                  <strong>{item.name}</strong>
                  <span>{item.summary.label}</span>
                </button>
              ))}
            </nav>
            <article
              tabIndex={-1}
              className="rationale-card"
              key={selected.element.id}
              id={`basis-${selected.element.id}`}
              aria-labelledby="rationale-decision-title"
            >
              <button
                className="review-back link-button"
                onClick={() => {
                  setShowDetail(false);
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLButtonElement>(
                        '.rationale-decision-list button[aria-current]',
                      )
                      ?.focus(),
                  );
                }}
              >
                <ArrowLeft size={15} />К списку решений
              </button>
              <div className="rationale-card-heading">
                <h3 id="rationale-decision-title">{selected.name}</h3>
                <Badge tone={selected.summary.tone}>{selected.summary.label}</Badge>
              </div>
              <div className="rationale-answer">
                <h4>Что выбрано</h4>
                <p>{selected.decision}</p>
              </div>
              <div className="rationale-answer">
                <h4>Почему</h4>
                <p>{selected.summary.why}</p>
              </div>
              <div className="rationale-next-step">
                <h4>{selected.summary.needsReview ? 'Что ещё проверить' : 'Следующий шаг'}</h4>
                <p>{selected.summary.next}</p>
              </div>
              {!!selected.records.length && (
                <details className="rationale-evidence">
                  <summary>
                    Источники и подробности <span>{selected.records.length}</span>
                  </summary>
                  {selected.records.map((record) => {
                    const source = sourceById(s, record.source_id);
                    return (
                      <section className="rationale-source" key={record.id}>
                        <div className="rationale-source-heading">
                          <h4>{basisLabels[record.kind]}</h4>
                          <Badge>{statusLabels[record.status]}</Badge>
                        </div>
                        <p>
                          <strong>На что опираемся: </strong>
                          {record.source_id === 'request'
                            ? 'Ваш запрос при создании этой версии курса.'
                            : source?.name || 'Подтверждающий источник не указан.'}
                        </p>
                        {record.fragment && <blockquote>{readable(record.fragment)}</blockquote>}
                        {record.applicability && (
                          <p>
                            <strong>Что это объясняет: </strong>
                            {readable(record.applicability)}
                          </p>
                        )}
                        {record.limitations && (
                          <p>
                            <strong>Границы объяснения: </strong>
                            {readable(record.limitations)}
                          </p>
                        )}
                        {!rationaleIsSupported(s, record, signature) && (
                          <p className="rationale-source-note">
                            Этого пока недостаточно, чтобы считать решение проверенным для вашей
                            группы.
                          </p>
                        )}
                        <details className="rationale-record">
                          <summary>Полная запись проверки</summary>
                          <dl>
                            {[
                              ['Решение', record.decision],
                              ['Зачем предложено', record.purpose],
                              ['Другие варианты', record.alternatives],
                              ['Надёжность основания', record.trust],
                              ['Что проверено', record.verification],
                              ['Что проверить дальше', record.next_check],
                              ['Кто проверил', record.reviewer || 'Проверяющий пока не указан'],
                              ['Дата проверки', record.checked_at || 'Пока не указана'],
                              ['Где в источнике', record.coordinate || 'Место не указано'],
                            ].map(([label, value]) => (
                              <div key={label}>
                                <dt>{label}</dt>
                                <dd>{readable(value)}</dd>
                              </div>
                            ))}
                            <div>
                              <dt>Когда добавлено</dt>
                              <dd>
                                {record.phase === 'design'
                                  ? 'При составлении плана'
                                  : 'При последующей проверке'}
                              </dd>
                            </div>
                            {source && (
                              <div>
                                <dt>Источник прочитан</dt>
                                <dd>
                                  {source.provenance?.access === 'read'
                                    ? 'Да, в указанном объёме'
                                    : 'Чтение не подтверждено'}
                                  . {source.scope}
                                </dd>
                              </div>
                            )}
                            <div>
                              <dt>Код записи для сверки</dt>
                              <dd>
                                <code>
                                  {record.id} · версия {record.version}
                                </code>
                              </dd>
                            </div>
                          </dl>
                        </details>
                      </section>
                    );
                  })}
                </details>
              )}
            </article>
          </div>
        </>
      ) : (
        <div className="rationale-empty" role="status">
          <h3>Пояснений по этим условиям нет</h3>
          <p>Попробуйте другое слово.</p>
          <button
            onClick={() => {
              setQuery('');
              changeGroup('intent');
            }}
          >
            Сбросить поиск
          </button>
        </div>
      )}
    </Panel>
  );
}
