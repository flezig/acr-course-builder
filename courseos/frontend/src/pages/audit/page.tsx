import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, CircleDashed, RefreshCw } from 'lucide-react';
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
  problem: 'Проблема',
  not_checked: 'Не проверено: не хватает данных',
  manual_review: 'Проверяет методист',
};
export function AuditPage() {
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
  const verdict = programVerdict(snapshot);
  const count = (status: ChecklistItem['status']) =>
    all.filter((item) => item.status === status).length;
  const itemHref = ({ target }: ChecklistItem) =>
    target.screen === 'materials'
      ? `/courses/${snapshot.course_id}/materials${suffix}`
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
        <button
          disabled={
            !view.is_latest || command.isPending || ['running', 'queued'].includes(view.job.status)
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
      </header>
      <section id="audit-checklist" className="audit-section" aria-label="Чек-лист">
        <dl className="checklist-summary">
          <div>
            <dt>Пройдено</dt>
            <dd>{count('passed')}</dd>
          </div>
          <div>
            <dt>Проблема</dt>
            <dd>{count('problem')}</dd>
          </div>
          <div>
            <dt>Не проверено</dt>
            <dd>{count('not_checked')}</dd>
          </div>
          <div>
            <dt>Проверяет методист</dt>
            <dd>{count('manual_review')}</dd>
          </div>
        </dl>
        {(
          [
            [
              'Общие требования',
              'Из файла открытых запросов: проверяются в любой программе.',
              general,
            ],
            ['Требования запроса', snapshot.skeleton.requirements.title, request],
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
