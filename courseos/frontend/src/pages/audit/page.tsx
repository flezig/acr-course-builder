import { useState } from 'react';
import { FeedbackPrompt } from '../../features/response-feedback/feedback-prompt';
import { Link } from 'react-router-dom';
import {
  ArrowDownUp,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  CircleDashed,
  RefreshCw,
} from 'lucide-react';
import {
  generalRequirements,
  requestChecklist,
  type ChecklistItem,
} from '../../entities/course/model/checklist';
import { useCommand, useCourse } from '../../entities/course/api/provider';
import { Badge, Empty, ErrorMessage, Loading, Notice, Panel } from '../../shared/ui/ui';
import { programVerdict } from '../../entities/course/model/rules';
import './audit.css';
const checklistStatuses: Record<ChecklistItem['status'], string> = {
  passed: 'Пройдено',
  exception_accepted: 'Принято исключение',
  problem: 'Проблема',
  not_checked: 'Не проверено: не хватает данных',
  manual_review: 'Проверяет методист',
};
// Порядок важен дважды: так сортируются требования и так идут переключатели фильтра.
const statusOrder: ChecklistItem['status'][] = [
  'problem',
  'not_checked',
  'manual_review',
  'exception_accepted',
  'passed',
];
// В бейджах строки нужны полные пояснения, а в переключателях — короткие подписи.
const statusFilterTitles: Record<ChecklistItem['status'], string> = {
  ...checklistStatuses,
  not_checked: 'Не проверено',
};

export function AuditPage() {
  const [statusFilter, setStatusFilter] = useState<'all' | ChecklistItem['status']>('all');
  const [sortOrder, setSortOrder] = useState<'priority' | 'title' | 'original'>('priority');
  const query = useCourse();
  const command = useCommand();
  if (query.isPending) return <Loading />;
  if (!query.data) return <ErrorMessage error={query.error} />;
  const view = query.data;
  const snapshot = view.snapshot;
  if (!snapshot) return <Empty title="Проверять пока нечего">Завершите уточнения.</Empty>;
  const suffix = view.is_latest ? '' : `?version=${snapshot.course_version}`;
  const general = generalRequirements(snapshot);
  const request = requestChecklist(snapshot);
  const all = [...general, ...request];
  const visibleItems = (items: ChecklistItem[]) =>
    items
      .filter((item) => statusFilter === 'all' || item.status === statusFilter)
      .sort((left, right) =>
        sortOrder === 'priority'
          ? statusOrder.indexOf(left.status) - statusOrder.indexOf(right.status)
          : sortOrder === 'title'
            ? left.title.localeCompare(right.title, 'ru')
            : 0,
      );
  const visibleCount = all.filter(
    (item) => statusFilter === 'all' || item.status === statusFilter,
  ).length;
  const verdict = programVerdict(snapshot);
  const count = (status: ChecklistItem['status']) =>
    all.filter((item) => item.status === status).length;
  const itemHref = ({ target }: ChecklistItem) =>
    target.screen === 'materials'
      ? `/courses/${snapshot.course_id}/materials${suffix}${target.hash ? `#${target.hash}` : ''}`
      : `/courses/${snapshot.course_id}/${target.screen}${suffix}${target.hash ? `#${target.hash}` : ''}`;
  return (
    <>
      <header className="page-heading heading-action">
        <div>
          <h1>Проверка программы</h1>
          <p>
            Отчёт автопроверки: замечания, покрытие результатов обучения, источники и полнота
            обязательных разделов. «Не проверено» — не хватает данных; «Проверяет методист» — нужна
            содержательная ручная проверка.
          </p>
        </div>
        <div className="heading-buttons">
          <button
            className="secondary"
            disabled={
              !view.is_latest ||
              command.isPending ||
              ['running', 'queued'].includes(view.job.status)
            }
            onClick={() =>
              command.mutate({
                action: 'audit',
                expected_version: snapshot.course_version,
                payload: {},
              })
            }
          >
            <RefreshCw size={16} />
            Повторить проверку
          </button>
          <Link className="button" to={`/courses/${snapshot.course_id}/materials${suffix}`}>
            Материалы и выгрузки
            <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      <section id="audit-checklist" className="audit-section" aria-label="Чек-лист">
        <div className="checklist-toolbar">
          <div className="checklist-filters" role="group" aria-label="Статус">
            {(['all', ...statusOrder] as const).map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={statusFilter === status}
                onClick={() => setStatusFilter(status)}
              >
                {status === 'all' ? 'Все' : statusFilterTitles[status]}
                <span
                  className={`checklist-filter-count${status === 'problem' && count('problem') > 0 ? ' has-problems' : ''}`}
                >
                  {status === 'all' ? all.length : count(status)}
                </span>
              </button>
            ))}
          </div>
          <label className="checklist-sort">
            <ArrowDownUp size={14} aria-hidden="true" />
            <select
              aria-label="Сортировка"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}
            >
              <option value="priority">Сначала проблемы</option>
              <option value="title">По названию</option>
              <option value="original">Исходный порядок</option>
            </select>
          </label>
        </div>
        {visibleCount === 0 && (
          <Empty title="Требований с таким статусом нет">
            Выберите другой статус или{' '}
            <button className="link-button" onClick={() => setStatusFilter('all')}>
              покажите все требования
            </button>
            .
          </Empty>
        )}
        {(
          [
            [
              'Общие требования',
              'Из файла открытых запросов: проверяются в любой программе.',
              visibleItems(general),
            ],
            ['Требования запроса', snapshot.skeleton.requirements.title, visibleItems(request)],
          ] as const
        )
          .filter(([, , items]) => items.length > 0)
          .map(([title, subtitle, items]) => (
            <Panel key={title} title={title} subtitle={subtitle} className="checklist-panel">
              <ul className="checklist">
                {items.map((item) => (
                  <li key={item.id} className={`checklist-item ${item.status}`}>
                    {item.status === 'passed' ? (
                      <CheckCircle2 className="green-icon" size={18} aria-hidden="true" />
                    ) : item.status === 'problem' ? (
                      <AlertTriangle className="red-icon" size={18} aria-hidden="true" />
                    ) : (
                      <CircleDashed size={18} aria-hidden="true" />
                    )}
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.evidence}</p>
                    </div>
                    <Badge
                      tone={
                        item.status === 'passed'
                          ? 'green'
                          : item.status === 'problem'
                            ? 'red'
                            : 'neutral'
                      }
                    >
                      {checklistStatuses[item.status]}
                    </Badge>
                    <Link className="checklist-link" to={itemHref(item)}>
                      Открыть
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
      </section>
      {snapshot.audit.at && (
        <FeedbackPrompt
          key={`${snapshot.course_id}-${snapshot.course_version}-audit`}
          subject="generation"
          section="audit"
          actionLabel="Оценить проверку"
          question="Насколько полезны результаты проверки?"
        />
      )}
      <Notice>
        {snapshot.audit.at
          ? `Аудит выполнен. Блокируют утверждение: ${verdict.open}. Решено методистом: ${snapshot.audit.issues.filter((issue) => issue.decision).length}.`
          : 'Аудит ещё не выполнен.'}{' '}
        {snapshot.approval_applicable
          ? 'Программа утверждена.'
          : 'Программа ожидает утверждения методиста.'}
      </Notice>
      <ErrorMessage error={command.error} />
    </>
  );
}
