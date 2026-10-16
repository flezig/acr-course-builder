import { useSearchParams, Link } from 'react-router-dom';
import { Layers3 } from 'lucide-react';
import { useCourse } from '../../entities/course/api/provider';
import { materialLabels } from '../../entities/course/model/presets';
import { Badge, Empty, ErrorMessage, Loading, Notice, Panel } from '../../shared/ui/ui';
import { JobPanel } from '../../entities/job/job-panel';
import { sectionCompleteness } from '../../entities/course/model/sections';
import { StoragePanel } from '../../features/export-course/storage-panel';
import { ExportPanel } from '../../features/export-course/export-panel';
import { MaterialViewer } from './material-viewer';
export function MaterialsPage() {
  const query = useCourse();
  const [search, setSearch] = useSearchParams();
  if (query.isPending) return <Loading />;
  if (!query.data) return <ErrorMessage error={query.error} />;
  const view = query.data;
  const snapshot = view.snapshot
    ? {
        ...view.snapshot,
        materials: view.snapshot.materials.length
          ? view.snapshot.materials
          : view.job.partial_materials,
      }
    : null;
  if (!snapshot)
    return (
      <Empty title="Материалы пока недоступны">
        Завершите уточнения и утвердите структуру программы.
      </Empty>
    );
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    next.set(key, value);
    if (key === 'module' || key === 'type') next.delete('material');
    setSearch(next);
  };
  const tab =
    search.get('tab') ||
    (window.location.hash.startsWith('#section')
      ? 'sections'
      : window.location.hash === '#exports'
        ? 'exports'
        : 'content');
  const moduleId = search.get('module') || '';
  const type = search.get('type') || '';
  const selected = search.get('material');
  const active = ['queued', 'running'].includes(view.job.status);
  const readonly = !view.is_latest || active;
  const materials = snapshot.materials.filter(
    (m) => (!moduleId || m.module_id === moduleId) && (!type || m.type === type),
  );
  return (
    <>
      <header id="exports" className="page-heading">
        <div>
          <h1>Материалы программы</h1>
          <p>
            Планы лекций и содержание слайдов по модулям, практические задания и тесты.
            {snapshot.mode === 'demo' &&
              ' В демо это текстовые черновики; скачивание презентаций в .pptx недоступно.'}
          </p>
        </div>
      </header>
      <JobPanel job={view.job} version={view.latest_version} readonly={!view.is_latest} />
      {active && snapshot.materials.length > 0 && (
        <Notice>
          Частично готовые материалы сохранены в задаче. Следующая версия ещё не опубликована;
          редактирование доступно после завершения.
        </Notice>
      )}
      <div className="readiness">
        <Badge tone={snapshot.audit.technical_ready ? 'green' : 'amber'}>
          Технически: {snapshot.audit.technical_ready ? 'черновик полный' : 'не завершён'}
        </Badge>
        <Badge>Выпуск программы: не разрешён</Badge>
      </div>
      <div className="tabs" role="tablist" aria-label="Разделы материалов">
        {[
          { id: 'content', label: 'Содержание' },
          { id: 'exports', label: 'Выгрузки' },
          { id: 'sections', label: 'Разделы программы' },
        ].map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => setParam('tab', item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'sections' ? (
        <Panel
          title="Разделы выбранного образца"
          subtitle="Проверяется наличие необходимых полей. Предметная и нормативная экспертиза не выполнена."
        >
          <div id="sections">
            {sectionCompleteness(snapshot).map((item) => (
              <details
                key={item.title}
                id={item.section?.id}
                open={window.location.hash === `#${item.section?.id}`}
              >
                <summary>
                  {item.title} · {item.complete ? 'Поля заполнены' : 'Не завершён'}
                </summary>
                {item.section ? (
                  <pre className="material-content">{item.section.content}</pre>
                ) : (
                  <p>Раздел ещё не создан.</p>
                )}
                {!item.complete && <p>Нужно заполнить: {item.missing.join('; ')}</p>}
              </details>
            ))}
          </div>
        </Panel>
      ) : tab === 'exports' ? (
        <>
          <ExportPanel snapshot={snapshot} />
          <StoragePanel snapshot={snapshot} versions={view.versions} />
        </>
      ) : !snapshot.materials.length ? (
        <Empty
          title={
            active ? 'Создаются материалы по модулям' : 'Сначала утвердите структуру программы'
          }
        >
          <Link to={`/courses/${snapshot.course_id}/plan`}>Перейти к программе →</Link>
        </Empty>
      ) : (
        <div className="materials-layout">
          <aside>
            <Panel title="Материалы по модулям">
              <label className="field">
                <span>Модуль</span>
                <select
                  aria-label="Модуль"
                  value={moduleId}
                  onChange={(e) => setParam('module', e.target.value)}
                >
                  <option value="">Все модули · полный просмотр</option>
                  {Array.from(new Set(snapshot.materials.map((m) => m.module_id))).map((id) => (
                    <option key={id} value={id}>
                      {id === 'module-final'
                        ? 'Итоговая аттестация'
                        : `Модуль ${id.replace('module-', '')}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Тип материала</span>
                <select
                  aria-label="Тип материала"
                  value={type}
                  onChange={(e) => setParam('type', e.target.value)}
                >
                  <option value="">Все типы</option>
                  {Object.entries(materialLabels).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="material-list">
                {materials.map((material) => (
                  <button
                    className={selected === material.id ? 'selected' : ''}
                    key={material.id}
                    onClick={() => setParam('material', material.id)}
                  >
                    <Layers3 size={16} />
                    <span>
                      {material.title}
                      <small>
                        {material.stale ? 'Ожидает обновления' : materialLabels[material.type]}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              <button
                className="link-button"
                onClick={() => {
                  const next = new URLSearchParams(search);
                  next.delete('material');
                  setSearch(next);
                }}
              >
                Просмотр полного модуля
              </button>
            </Panel>
          </aside>
          <div>
            {snapshot.skeleton.requirements.delivery.includes('Стажировка') && (
              <Notice tone="warning">
                Контактных часов нет. Лекции и слайды не добавлены: применимость этих материалов
                требует решения кейсодателя. Нули в учебном плане сохранены.
              </Notice>
            )}
            {(selected && materials.some((m) => m.id === selected)
              ? materials.filter((m) => m.id === selected)
              : materials
            ).map((material) => (
              <Panel key={material.id}>
                <MaterialViewer material={material} snapshot={snapshot} readonly={readonly} />
              </Panel>
            ))}
            {!materials.length && (
              <Empty title="Материалов с таким фильтром нет">Выберите другой модуль или тип.</Empty>
            )}
          </div>
        </div>
      )}
      <ErrorMessage error={query.error} />
    </>
  );
}
