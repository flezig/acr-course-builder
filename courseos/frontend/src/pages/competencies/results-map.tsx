import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  X,
  Plus,
  Minus,
  Maximize2,
  FileText,
  Target,
  BookOpen,
  ClipboardCheck,
  Search,
  Network,
  List,
  ArrowRight,
  RotateCcw,
  Link2,
  ChevronRight,
  Info,
} from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import { kindLabels } from '../../entities/course/model/presets';
import { SkeletonEditor } from '../course-plan/skeleton-editor';
import { buildMap, relatedChain, type MapNode } from './map-model';
import { MapLinkEditor, type LinkRequest } from './map-link-editor';

const columnIcons = [FileText, Target, BookOpen, ClipboardCheck];
const layers = ['Требования', 'Результаты', 'Обучение', 'Оценивание'];
const gapFilters = {
  '': 'Все состояния связей',
  problems: 'Требуют проверки',
  learning: 'Нет обучения / темы / практики',
  assessment: 'Нет оценивания',
  requirement: 'Нет требования',
  unlinked: 'Не связан с результатами',
};
type GapFilter = keyof typeof gapFilters;
const plural = (n: number, forms: string[]) =>
  forms[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2];

export function ResultsMap({
  snapshot,
  editable,
  initialSearch,
}: {
  snapshot: Snapshot;
  editable: boolean;
  initialSearch: string;
}) {
  const { nodes, edges } = useMemo(() => buildMap(snapshot.skeleton), [snapshot.skeleton]);
  const [mode, setMode] = useState<'overview' | 'map'>('overview');
  const [search, setSearch] = useState(initialSearch);
  const [kind, setKind] = useState('');
  const [gapFilter, setGapFilter] = useState<GapFilter>('');
  const [outcomeId, setOutcomeId] = useState<string | null>(null);
  const [selectedId, select] = useState<string | null>(null);
  const [hoveredId, hover] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showAllEdges, setShowAllEdges] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(64);
  const [detailTop, setDetailTop] = useState(144);
  const [editing, setEditing] = useState(false);
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const zoomInitialized = useRef(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const directById = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const adjacent = new Map<string, MapNode[]>();
    for (const e of edges) {
      adjacent.set(e.from, [...(adjacent.get(e.from) || []), byId.get(e.to)!]);
      adjacent.set(e.to, [...(adjacent.get(e.to) || []), byId.get(e.from)!]);
    }
    return adjacent;
  }, [nodes, edges]);
  const selected = nodes.find((n) => n.id === selectedId);
  const outcomes = nodes.filter((n) => n.column === 1);
  const allOrphans = nodes.filter((n) => n.column !== 1 && n.gap);
  const problemOutcomes = outcomes.filter((n) => n.gap);
  const normalizedSearch = search.trim().toLocaleLowerCase('ru');
  const filtering = !!(kind || gapFilter || normalizedSearch);
  const matches = (n: MapNode) =>
    `${n.originalTitle} ${n.description} ${n.type} ${n.criterion || ''}`
      .toLocaleLowerCase('ru')
      .includes(normalizedSearch);
  const neighbors = (id: string) => directById.get(id) || [];
  const hasLink = (id: string, prefix: string) =>
    neighbors(id).some((n) => n.id.startsWith(`${prefix}:`));
  // Match results against their actual neighbors, never other results sharing a requirement.
  const filteredOutcomes = outcomes.filter(
    (o) =>
      (!kind || o.kind === kind) &&
      (!gapFilter ||
        (gapFilter === 'problems' && o.gap) ||
        (gapFilter === 'learning' && (!hasLink(o.id, 'topic') || !hasLink(o.id, 'activity'))) ||
        (gapFilter === 'assessment' && !hasLink(o.id, 'assessment')) ||
        (gapFilter === 'requirement' && !hasLink(o.id, 'requirement'))) &&
      (!normalizedSearch || matches(o) || neighbors(o.id).some(matches)),
  );
  const orphans = allOrphans.filter(
    (n) =>
      (!normalizedSearch || matches(n)) &&
      (!gapFilter || gapFilter === 'problems' || gapFilter === 'unlinked'),
  );
  const currentOutcome = filteredOutcomes.find((n) => n.id === outcomeId) || filteredOutcomes[0];
  const currentLinks = currentOutcome ? neighbors(currentOutcome.id) : [];
  const currentRequirements = currentLinks.filter((n) => n.column === 0);
  const visibleIds = new Set<string>();
  for (const o of filteredOutcomes)
    for (const id of relatedChain(o.id, nodes, edges)) visibleIds.add(id);
  if (!filtering) nodes.forEach((n) => visibleIds.add(n.id));
  orphans.forEach((n) => {
    visibleIds.add(n.id);
    // An unlinked assessment may still have an explicit topic association.
    neighbors(n.id).forEach((neighbor) => visibleIds.add(neighbor.id));
  });
  const mapNodes = nodes.filter((n) => visibleIds.has(n.id));
  const activeId = mode === 'map' ? selectedId || hoveredId : null;
  const chain = activeId ? new Set([activeId, ...neighbors(activeId).map((n) => n.id)]) : null;
  const visibleEdges = edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));
  const displayedEdges = showAllEdges
    ? visibleEdges
    : visibleEdges.filter((e) => e.from === activeId || e.to === activeId);
  const cardHeight = (n: MapNode) => (n.gap ? 108 : 80);
  const positions = new Map<string, { x: number; y: number }>();
  const bottoms = layers.map((_, c) => {
    let y = 84;
    for (const n of mapNodes.filter((n) => n.column === c)) {
      positions.set(n.id, { x: 24 + c * 290, y });
      y += cardHeight(n) + 18;
    }
    return y;
  });
  const height = Math.max(380, ...bottoms);
  const noResults = !filteredOutcomes.length && !orphans.length;
  const searchHits = normalizedSearch
    ? nodes.filter((n) => n.column !== 1 && matches(n) && visibleIds.has(n.id))
    : [];
  const plan = `/courses/${snapshot.course_id}/plan${editable ? '' : `?version=${snapshot.course_version}`}`;
  const detailId = 'map-object-details';

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (zoomInitialized.current) return;
      zoomInitialized.current = true;
      setZoom(Math.min(1, el.clientWidth / 1184));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode, noResults]);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.topbar');
    const toolbar = document.querySelector<HTMLElement>('.map-control-bar');
    const update = () => {
      const h = Math.max(0, header?.getBoundingClientRect().bottom || 0);
      setHeaderHeight(h);
      setDetailTop(Math.max(h, toolbar?.getBoundingClientRect().bottom || h) + 12);
    };
    const observer = new ResizeObserver(update);
    if (header) observer.observe(header);
    if (toolbar) observer.observe(toolbar);
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  useEffect(() => {
    if (selected) details.current?.focus({ preventScroll: true });
  }, [selectedId]);
  useEffect(() => {
    if (selectedId && !visibleIds.has(selectedId)) select(null);
  }, [search, kind, gapFilter]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editing && !linkRequest && selectedId) {
        e.preventDefault();
        closeDetails();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [editing, linkRequest, selectedId]);
  function openDetails(id: string) {
    if (!selectedId) opener.current = document.activeElement as HTMLElement;
    const n = nodes.find((item) => item.id === id);
    const linkedResults = neighbors(id).filter((item) => item.column === 1);
    if (n?.column === 1) {
      if (!filteredOutcomes.some((o) => o.id === id)) resetFilters();
      setOutcomeId(id);
    } else if (!linkedResults.some((item) => item.id === currentOutcome?.id) && linkedResults[0])
      setOutcomeId(linkedResults[0].id);
    select(id);
    hover(null);
  }
  function closeDetails() {
    select(null);
    opener.current?.focus({ preventScroll: true });
    hover(null);
  }
  function resetFilters() {
    setSearch('');
    setKind('');
    setGapFilter('');
  }
  function showSummary(filter: GapFilter) {
    resetFilters();
    setGapFilter(filter);
    setMode('overview');
    select(null);
  }
  function chooseOutcome(id: string) {
    setOutcomeId(id);
    select(null);
    hover(null);
  }
  function fit() {
    const el = viewport.current;
    if (el) {
      setZoom(Math.min(1.5, el.clientWidth / 1184, el.clientHeight / height));
      el.scrollTo(0, 0);
    }
  }
  function badge(n: MapNode) {
    const category = n.column === 1 ? n.kind : n.id.split(':')[0];
    return <small className={`node-badge badge-${category}`}>{n.type}</small>;
  }
  function warnings(n: MapNode) {
    return (
      n.warnings.length > 0 && (
        <span className="node-warnings">
          <AlertTriangle size={13} aria-hidden="true" />
          {n.warnings.join(' · ')}
        </span>
      )
    );
  }
  function node(n: MapNode, graph = false) {
    const p = positions.get(n.id);
    const linkedResults = neighbors(n.id).filter((item) => item.column === 1);
    return (
      <button
        key={n.id}
        title={n.originalTitle}
        aria-controls={selectedId === n.id ? detailId : undefined}
        className={`${graph ? 'map-card' : 'chain-card'} ${n.gap ? 'has-gap' : ''} ${chain && !chain.has(n.id) ? 'dimmed' : ''} ${chain?.has(n.id) ? 'related' : ''} ${selectedId === n.id ? 'selected' : ''} ${normalizedSearch && matches(n) ? 'search-match' : ''}`}
        style={
          graph && p
            ? { left: p.x, top: p.y, height: cardHeight(n), minHeight: cardHeight(n) }
            : undefined
        }
        onMouseEnter={() => graph && hover(n.id)}
        onMouseLeave={() => hover(null)}
        onFocus={() => graph && hover(n.id)}
        onBlur={() => hover(null)}
        onClick={() => openDetails(n.id)}
        aria-pressed={selectedId === n.id}
      >
        <span className="node-meta">
          {badge(n)}
          {!graph && linkedResults.length > 0 && (
            <small>
              {linkedResults.length}{' '}
              {plural(linkedResults.length, ['результат', 'результата', 'результатов'])} · открыть
              связи
            </small>
          )}
        </span>
        <strong>{n.title}</strong>
        {warnings(n)}
      </button>
    );
  }
  function group(items: MapNode[], label: string) {
    return (
      <section className="connection-group" aria-label={label}>
        <h4>
          {label}
          <span>{items.length}</span>
        </h4>
        {items.slice(0, 3).map((n) => node(n))}
        {items.length > 3 && (
          <details>
            <summary>
              Все {items.length} · {label.toLocaleLowerCase('ru')}
            </summary>
            <div className="expanded-connections">{items.slice(3).map((n) => node(n))}</div>
          </details>
        )}
      </section>
    );
  }
  function gap(outcome: MapNode, target: LinkRequest['target'], label: string, action: string) {
    return (
      <div className="map-gap">
        <span>
          <AlertTriangle size={14} />
          {label}
        </span>
        {editable ? (
          <button onClick={() => setLinkRequest({ node: outcome, target })}>
            <Plus size={13} />
            {action}
          </button>
        ) : (
          <small>Редактирование доступно в актуальной ревизии</small>
        )}
      </div>
    );
  }
  function outcomeGaps(o: MapNode, column?: number) {
    return (
      <>
        {(column === undefined || column === 0) &&
          !hasLink(o.id, 'requirement') &&
          gap(o, 'requirement', 'Нет требования', 'Привязать требование')}
        {(column === undefined || column === 2) &&
          !hasLink(o.id, 'topic') &&
          gap(o, 'topic', 'Нет темы', 'Привязать тему')}
        {(column === undefined || column === 2) &&
          !hasLink(o.id, 'activity') &&
          gap(o, 'activity', 'Нет практики', 'Привязать практику')}
        {(column === undefined || column === 3) &&
          !hasLink(o.id, 'assessment') &&
          gap(o, 'assessment', 'Нет оценивания', 'Добавить проверку')}
      </>
    );
  }
  const direct = selected ? neighbors(selected.id) : [];
  const remarks = selected
    ? [...snapshot.audit.issues, ...snapshot.observations].filter(
        (issue, index, all) =>
          issue.element_id === selected.sourceId &&
          all.findIndex((other) => other.id === issue.id) === index,
      )
    : [];
  return (
    <>
      <header className="results-heading">
        <div>
          <h1>Карта связей</h1>
          <p>Выберите результат: где он формируется, чем проверяется и каких связей не хватает.</p>
        </div>
      </header>
      <section
        className="results-map results-workspace"
        style={{ '--map-sticky-top': `${headerHeight}px` } as CSSProperties}
        aria-label="Карта результатов"
      >
        <div className="map-control-bar">
          <div className="map-toolbar">
            <div className={`map-search ${search ? 'is-active' : ''}`}>
              <Search size={16} />
              <input
                aria-label="Поиск по карте"
                placeholder="Найти результат, тему, оценивание…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button aria-label="Очистить поиск" onClick={() => setSearch('')}>
                  <X size={14} />
                </button>
              )}
            </div>
            <select
              className={kind ? 'is-active' : ''}
              aria-label="Тип результата"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">Все типы результатов</option>
              {Object.entries(kindLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              className={gapFilter ? 'is-active' : ''}
              aria-label="Пробелы в связях"
              value={gapFilter}
              onChange={(e) => setGapFilter(e.target.value as GapFilter)}
            >
              {Object.entries(gapFilters).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="map-mode-toggle"
              onClick={() => {
                setMode(mode === 'map' ? 'overview' : 'map');
                hover(null);
              }}
            >
              {mode === 'overview' ? <Network size={16} /> : <List size={16} />}
              {mode === 'overview' ? 'Показать всю карту' : 'К результатам'}
            </button>
          </div>
          {filtering && (
            <div className="map-active-filters" aria-label="Активные фильтры">
              <span role="status">
                Показано {filteredOutcomes.length} из {outcomes.length} результатов ·{' '}
                {orphans.length} объектов без результатов
              </span>
              {normalizedSearch && (
                <button onClick={() => setSearch('')}>
                  Поиск: {search}
                  <X size={12} />
                </button>
              )}
              {kind && (
                <button onClick={() => setKind('')}>
                  {kindLabels[kind as keyof typeof kindLabels]}
                  <X size={12} />
                </button>
              )}
              {gapFilter && (
                <button onClick={() => setGapFilter('')}>
                  {gapFilters[gapFilter]}
                  <X size={12} />
                </button>
              )}
              <button className="map-reset" onClick={resetFilters}>
                <RotateCcw size={12} />
                Сбросить фильтры
              </button>
            </div>
          )}
        </div>
        <nav className="map-summary" aria-label="Сводка результатов">
          <button onClick={() => showSummary('')}>
            <Target size={16} />
            <strong>{outcomes.length}</strong>{' '}
            {plural(outcomes.length, ['результат', 'результата', 'результатов'])}
          </button>
          <button
            className={problemOutcomes.length ? 'summary-attention' : ''}
            onClick={() => showSummary('problems')}
          >
            <AlertTriangle size={16} />
            Требуют проверки: <strong>{problemOutcomes.length}</strong>
          </button>
          <button
            className={allOrphans.length ? 'summary-attention' : ''}
            onClick={() => showSummary('unlinked')}
          >
            <Link2 size={16} />
            <strong>{allOrphans.length}</strong> объектов без результатов
          </button>
        </nav>
        <div className="map-body">
          <div className="map-main">
            {noResults ? (
              <div className="map-empty" role="status">
                <Search size={28} />
                <h2>
                  {!outcomes.length && !filtering
                    ? 'В программе пока нет результатов'
                    : gapFilter === 'problems' && !kind && !normalizedSearch
                      ? 'Пробелов в связях не найдено'
                      : 'Ничего не найдено'}
                </h2>
                <p>
                  {filtering
                    ? 'Измените запрос или сбросьте фильтры, чтобы увидеть программу.'
                    : 'Добавьте результаты и учебные элементы в редакторе каркаса.'}
                </p>
                {filtering ? (
                  <button onClick={resetFilters}>Показать все результаты</button>
                ) : (
                  editable && <button onClick={() => setEditing(true)}>Редактировать программу</button>
                )}
              </div>
            ) : mode === 'overview' ? (
              <div className="outcome-workspace">
                <nav className="outcome-sidebar" aria-label="Результаты обучения">
                  <div className="sidebar-heading">
                    <h2>Результаты</h2>
                    <span>{filteredOutcomes.length}</span>
                  </div>
                  <div className="outcome-list">
                    {filteredOutcomes.map((o) => (
                      <button
                        key={o.id}
                        className={`outcome-list-item ${currentOutcome?.id === o.id ? 'is-current' : ''}`}
                        aria-current={currentOutcome?.id === o.id ? 'true' : undefined}
                        title={o.originalTitle}
                        onClick={() => chooseOutcome(o.id)}
                      >
                        <span className="result-number">
                          {String(outcomes.indexOf(o) + 1).padStart(2, '0')}
                        </span>
                        <span>
                          <strong>{o.title}</strong>
                          {warnings(o)}
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                    {!filteredOutcomes.length && (
                      <p className="sidebar-note">Результаты не соответствуют фильтрам.</p>
                    )}
                  </div>
                  {searchHits.length > 0 && (
                    <section className="sidebar-search-hits" aria-label="Найденные объекты">
                      <h3>Найденные объекты · {searchHits.length}</h3>
                      {searchHits.map((n) => node(n))}
                    </section>
                  )}
                  {orphans.length > 0 && (
                    <section className="sidebar-orphans" aria-label="Объекты без результатов">
                      <h3>
                        <AlertTriangle size={14} />
                        Без результатов · {orphans.length}
                      </h3>
                      <p>Не связан с результатами</p>
                      {orphans.map((n) => node(n))}
                    </section>
                  )}
                </nav>
                <div className="outcome-content" aria-label="Содержание выбранного результата">
                  {currentOutcome ? (
                    <article key={currentOutcome.id}>
                      <div className="selected-result-heading">
                        <span>
                          <Target size={15} />
                          Результат {String(outcomes.indexOf(currentOutcome) + 1).padStart(
                            2,
                            '0',
                          )}{' '}
                          из {outcomes.length}
                        </span>
                        {editable && (
                          <button
                            className="map-inline-action"
                            onClick={() =>
                              setLinkRequest({ node: currentOutcome, target: 'topic' })
                            }
                          >
                            <Link2 size={14} />
                            Настроить связи
                          </button>
                        )}
                      </div>
                      <div className="result-requirements">
                        <h3>
                          <FileText size={14} />
                          Исходные требования <span>{currentRequirements.length}</span>
                        </h3>
                        {currentRequirements.length === 1 ? (
                          <button
                            className="requirement-context"
                            title={currentRequirements[0].description}
                            onClick={() => openDetails(currentRequirements[0].id)}
                          >
                            <strong>{currentRequirements[0].title}</strong>
                            <span>{currentRequirements[0].description}</span>
                            <small>
                              Прочитать полностью
                              <ChevronRight size={13} />
                            </small>
                          </button>
                        ) : currentRequirements.length > 1 ? (
                          group(currentRequirements, 'Все требования')
                        ) : (
                          outcomeGaps(currentOutcome, 0)
                        )}
                      </div>
                      <div className="result-formulation">
                        {badge(currentOutcome)}
                        <h2>{currentOutcome.title}</h2>
                        {currentOutcome.description !== currentOutcome.title && (
                          <p className="full-outcome-text">{currentOutcome.description}</p>
                        )}
                        {warnings(currentOutcome)}
                        <button
                          className="map-inline-action"
                          onClick={() => openDetails(currentOutcome.id)}
                        >
                          Подробности результата
                          <ChevronRight size={14} />
                        </button>
                      </div>
                      <div className="result-connections">
                        <section className="learning-column" aria-label="Связанное обучение">
                          <h3>
                            <BookOpen size={17} />
                            Обучение<span>{currentLinks.filter((n) => n.column === 2).length}</span>
                          </h3>
                          <p className="column-caption">Где формируется результат</p>
                          {group(
                            currentLinks.filter((n) => n.id.startsWith('topic:')),
                            'Темы',
                          )}
                          {group(
                            currentLinks.filter((n) => n.id.startsWith('activity:')),
                            'Практика',
                          )}
                          {outcomeGaps(currentOutcome, 2)}
                        </section>
                        <section className="assessment-column" aria-label="Связанное оценивание">
                          <h3>
                            <ClipboardCheck size={17} />
                            Оценивание
                            <span>{currentLinks.filter((n) => n.column === 3).length}</span>
                          </h3>
                          <p className="column-caption">Чем проверяется достижение</p>
                          {group(
                            currentLinks.filter((n) => n.column === 3),
                            'Способы оценивания',
                          )}
                          {outcomeGaps(currentOutcome, 3)}
                        </section>
                      </div>
                    </article>
                  ) : (
                    <div className="map-empty orphan-context">
                      <Link2 size={28} />
                      <h2>Объекты без результатов</h2>
                      <p>
                        Выберите объект слева, чтобы прочитать формулировку, открыть его
                        существующие связи или привязать результаты.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="map-navigation">
                  <span className="map-view-caption">
                    {mapNodes.length} объектов · {visibleEdges.length} связей
                    {filtering ? ' · с учётом фильтров' : ''}
                  </span>
                  <label className="graph-lines-toggle">
                    <input
                      type="checkbox"
                      checked={showAllEdges}
                      onChange={(e) => setShowAllEdges(e.target.checked)}
                    />
                    Все линии
                  </label>
                  <div className="map-zoom-controls">
                    <button
                      aria-label="Уменьшить масштаб"
                      onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
                    >
                      <Minus size={15} />
                    </button>
                    <output aria-label="Масштаб">{Math.round(zoom * 100)}%</output>
                    <button
                      aria-label="Увеличить масштаб"
                      onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
                    >
                      <Plus size={15} />
                    </button>
                    <button onClick={fit}>
                      <Maximize2 size={15} />
                      Вписать в экран
                    </button>
                  </div>
                  {selectedId && (
                    <button onClick={closeDetails}>
                      <X size={14} />
                      Сбросить выделение
                    </button>
                  )}
                  <span className="map-context-hint">
                    {selected
                      ? `Прямые связи: ${selected.title}`
                      : showAllEdges
                        ? 'Все линии включены · выберите объект, чтобы выделить его связи'
                        : 'Выберите объект — появятся его прямые связи'}
                  </span>
                </div>
                <div
                  className="map-viewport"
                  ref={viewport}
                  tabIndex={0}
                  aria-label="Интерактивная карта, прокручивайте или перемещайте фон"
                  onPointerDown={(e) => {
                    if ((e.target as Element).closest('button')) return;
                    const el = e.currentTarget;
                    drag.current = {
                      x: e.clientX,
                      y: e.clientY,
                      left: el.scrollLeft,
                      top: el.scrollTop,
                    };
                    el.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!drag.current) return;
                    e.currentTarget.scrollLeft = drag.current.left - e.clientX + drag.current.x;
                    e.currentTarget.scrollTop = drag.current.top - e.clientY + drag.current.y;
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                >
                  <div style={{ width: 1184 * zoom, height: height * zoom }}>
                    <div
                      className="map-canvas"
                      style={{ width: 1184, height, transform: `scale(${zoom})` }}
                    >
                      {layers.map((label, i) => {
                        const Icon = columnIcons[i];
                        return (
                          <div
                            className="map-column-title"
                            key={label}
                            style={{ left: 24 + i * 290 }}
                          >
                            <div className="map-stage-heading">
                              <Icon size={16} />
                              <h3>{label}</h3>
                              <small>{mapNodes.filter((n) => n.column === i).length}</small>
                            </div>
                          </div>
                        );
                      })}
                      <svg className="map-lines" width={1184} height={height} aria-hidden="true">
                        <defs>
                          <marker
                            id="map-arrow"
                            viewBox="0 0 10 10"
                            refX="9"
                            refY="5"
                            markerWidth="6"
                            markerHeight="6"
                            orient="auto-start-reverse"
                          >
                            <polygon points="0,0 10,5 0,10" fill="#b7b7b7" />
                          </marker>
                          <marker
                            id="map-arrow-active"
                            viewBox="0 0 10 10"
                            refX="9"
                            refY="5"
                            markerWidth="6"
                            markerHeight="6"
                            orient="auto-start-reverse"
                          >
                            <polygon points="0,0 10,5 0,10" fill="var(--accent)" />
                          </marker>
                        </defs>
                        {[...displayedEdges]
                          .sort(
                            (a, b) =>
                              Number(a.from === activeId || a.to === activeId) -
                              Number(b.from === activeId || b.to === activeId),
                          )
                          .map((e) => {
                            const a = positions.get(e.from),
                              b = positions.get(e.to);
                            if (!a || !b) return null;
                            const active = e.from === activeId || e.to === activeId;
                            const laneY = 65 + (mapNodes.findIndex((n) => n.id === e.from) % 4) * 4;
                            const d =
                              b.x - a.x > 300
                                ? `M ${a.x + 248} ${a.y + 30} C ${a.x + 274} ${a.y + 30}, ${a.x + 264} ${laneY}, ${a.x + 280} ${laneY} L ${b.x - 28} ${laneY} C ${b.x - 12} ${laneY}, ${b.x - 22} ${b.y + 30}, ${b.x} ${b.y + 30}`
                                : `M ${a.x + 248} ${a.y + cardHeight(nodes.find((n) => n.id === e.from)!) / 2} C ${a.x + 270} ${a.y + cardHeight(nodes.find((n) => n.id === e.from)!) / 2}, ${b.x - 22} ${b.y + cardHeight(nodes.find((n) => n.id === e.to)!) / 2}, ${b.x} ${b.y + cardHeight(nodes.find((n) => n.id === e.to)!) / 2}`;
                            return (
                              <path
                                key={`${e.from}-${e.to}`}
                                className={active ? 'active' : chain ? 'muted' : ''}
                                markerEnd={`url(#map-arrow${active ? '-active' : ''})`}
                                d={d}
                              />
                            );
                          })}
                      </svg>
                      {mapNodes.map((n) => node(n, true))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
      {selected && (
        <aside
          ref={details}
          id={detailId}
          className="map-details results-detail-panel"
          style={{ top: detailTop }}
          tabIndex={-1}
          aria-label="Детали карточки"
        >
          <div className="details-topline">
            <span>
              <Info size={15} />
              Подробности объекта
            </span>
            <button className="map-close" aria-label="Закрыть детали" onClick={closeDetails}>
              <X size={18} />
            </button>
          </div>
          {badge(selected)}
          <h2>{selected.originalTitle}</h2>
          <h3>Полная формулировка</h3>
          <p>{selected.description}</p>
          {selected.criterion && (
            <>
              <h3>Критерий оценки</h3>
              <p>{selected.criterion}</p>
            </>
          )}
          {warnings(selected)}
          <h3>
            Связанные объекты <span>{direct.length}</span>
          </h3>
          <p className="detail-context-note">Показаны только прямые связи объекта.</p>
          {direct.length ? (
            layers.map((label, c) => {
              const items = direct.filter((n) => n.column === c);
              return (
                items.length > 0 && (
                  <section
                    key={label}
                    className="detail-link-group"
                    aria-label={`Связанные ${label.toLocaleLowerCase('ru')}`}
                  >
                    <h4>
                      {label} · {items.length}
                    </h4>
                    {items.map((n) => (
                      <button
                        className="map-detail-link"
                        key={n.id}
                        onClick={() => openDetails(n.id)}
                      >
                        {badge(n)}
                        <span>{n.title}</span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </section>
                )
              );
            })
          ) : (
            <p className="muted">Связей пока нет.</p>
          )}
          {selected.column === 1
            ? outcomeGaps(selected)
            : selected.gap &&
              editable && (
                <button
                  className="map-inline-action"
                  onClick={() => setLinkRequest({ node: selected, target: 'outcome' })}
                >
                  <Plus size={14} />
                  Привязать результат
                </button>
              )}
          {remarks.length > 0 && (
            <>
              <h3>Замечания программы · {remarks.length}</h3>
              {remarks.map((r) => (
                <p className="map-remark" key={r.id}>
                  <AlertTriangle size={14} />
                  {r.message}
                </p>
              ))}
            </>
          )}
          <h3>Действия</h3>
          {editable && (
            <>
              <button
                className="primary"
                onClick={() =>
                  setLinkRequest({
                    node: selected,
                    target: selected.column === 1 ? 'topic' : 'outcome',
                  })
                }
              >
                <Link2 size={14} />
                Настроить связи
              </button>
              <button onClick={() => setEditing(true)}>Редактировать программу</button>
            </>
          )}
          <Link className="button" to={`${plan}#${selected.sourceId}`}>
            Открыть учебный план
            <ArrowRight size={14} />
          </Link>
          {snapshot.material_links
            .filter((l) => l.assessment_id === selected.sourceId)
            .map((l) => (
              <Link
                className="button"
                key={l.material_id}
                to={`/courses/${snapshot.course_id}/materials?version=${snapshot.course_version}&material=${l.material_id}`}
              >
                Открыть материал
              </Link>
            ))}
          {!editable && <p className="muted">Эта ревизия доступна для просмотра.</p>}
        </aside>
      )}
      {linkRequest && (
        <MapLinkEditor
          snapshot={snapshot}
          request={linkRequest}
          close={() => setLinkRequest(null)}
          edit={() => {
            setLinkRequest(null);
            setEditing(true);
          }}
        />
      )}
      {editing && (
        <div className="map-editor-overlay">
          <div className="map-editor-content">
            <SkeletonEditor snapshot={snapshot} close={() => setEditing(false)} />
          </div>
        </div>
      )}
    </>
  );
}
