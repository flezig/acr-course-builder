import { useMemo, useState } from 'react';
import { ArrowLeft, Copy, Download, Search, X } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import {
  currentRationales,
  rationaleCoverage,
  rationaleSignature,
  skeletonElements,
  skeletonRationaleMarkdown,
} from '../../entities/course/model/rationale';
import { saveFile } from '../../shared/lib/use-unsaved';
import { Badge, Panel } from '../../shared/ui/ui';
import {
  elementDecision,
  elementModuleId,
  elementName,
  moduleHeading,
  rationaleGroup,
  rationaleGroups,
  rationaleSummary,
  type RationaleGroup,
} from './rationale-presentation';
import './rationale-panel.css';

// Внутри модуля его название уже в заголовке, поэтому пункты подписаны коротко.
function sectionItemName(id: string, moduleId: string | undefined, name: string) {
  if (id === moduleId) return 'Модуль целиком';
  return moduleId ? name.replace(/^Практика: .*/, 'Практика') : name;
}

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
  const items = useMemo(() => {
    const summaries = new Map(
      skeletonElements(s).map((element) => {
        const records = currentRationales(s, element.id, signature);
        return [element.id, { records, summary: rationaleSummary(s, element, records, signature) }];
      }),
    );
    // Критерий показан в описании своей проверки. Если по нему остались вопросы,
    // они видны в статусе проверки, чтобы не потеряться.
    return skeletonElements(s)
      .filter((element) => !element.id.startsWith('criterion:'))
      .map((element) => {
        const own = summaries.get(element.id)!;
        const criterion = summaries.get(`criterion:${element.id}`);
        const { records, summary } =
          criterion?.summary.needsReview && !own.summary.needsReview ? criterion : own;
        return {
          element,
          records,
          name: elementName(s, element),
          decision: elementDecision(s, element),
          group: rationaleGroup(s, element.id),
          summary,
        };
      });
  }, [s, signature]);
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
  const toDiscuss = items.filter((item) => item.summary.needsReview);
  // В разделе тем плоский список модулей и связей трудно читать, поэтому он разбит по модулям.
  const listSections =
    group === 'topics'
      ? [...new Set(filtered.map((item) => elementModuleId(s, item.element.id)))].map(
          (moduleId) => ({
            moduleId,
            heading: moduleId ? moduleHeading(s, moduleId) : 'Прочее',
            items: filtered.filter((item) => elementModuleId(s, item.element.id) === moduleId),
          }),
        )
      : [{ moduleId: undefined, heading: '', items: filtered }];
  // Вопрос пишется так, чтобы его можно было без правок переслать преподавателю или заказчику.
  const discussionQuestion = (item: (typeof items)[number]) =>
    `${item.name}: ${item.decision}\n${item.summary.next}`;
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState('');
  const copyQuestions = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError('');
      setCopied(key);
    } catch {
      setCopied('');
      setCopyError('Не удалось скопировать: браузер запретил доступ к буферу обмена.');
    }
  };
  const changeGroup = (value: typeof group) => {
    setShowDetail(false);
    setGroup(value);
    setSelectedId('');
  };

  return (
    <Panel title="Почему курс устроен так" className="rationale-panel">
      <div className="rationale-overview">
        <p>
          <strong>{coverage.confirmed + coverage.expert}</strong> с подтверждением
          <span aria-hidden="true"> · </span>
          <strong>{coverage.assumptions + coverage.gaps}</strong> требуют обсуждения
        </p>
        <div className="rationale-overview-actions">
          {!!toDiscuss.length && (
            <button
              className="rationale-download"
              onClick={() =>
                copyQuestions(
                  'all',
                  toDiscuss.map((item, i) => `${i + 1}. ${discussionQuestion(item)}`).join('\n\n'),
                )
              }
            >
              <Copy size={15} aria-hidden="true" />
              {copied === 'all'
                ? 'Вопросы скопированы'
                : `Скопировать вопросы для обсуждения · ${toDiscuss.length}`}
            </button>
          )}
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
      </div>
      {copyError && (
        <p className="rationale-copy-error" role="alert">
          {copyError}
        </p>
      )}
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
              {listSections.map((section) => (
                <div key={section.moduleId || 'all'} className="rationale-list-section">
                  {section.heading && <h4>{section.heading}</h4>}
                  {section.items.map((item) => (
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
                      <strong>
                        {sectionItemName(item.element.id, section.moduleId, item.name)}
                      </strong>
                      <span>{item.summary.label}</span>
                    </button>
                  ))}
                </div>
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
                <h4>{selected.summary.needsReview ? 'Вынесите на обсуждение' : 'Следующий шаг'}</h4>
                <p>{selected.summary.next}</p>
                {selected.summary.needsReview && (
                  <button
                    className="rationale-discuss"
                    onClick={() => copyQuestions(selected.element.id, discussionQuestion(selected))}
                  >
                    <Copy size={14} aria-hidden="true" />
                    {copied === selected.element.id ? 'Вопрос скопирован' : 'Скопировать вопрос'}
                  </button>
                )}
              </div>
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
