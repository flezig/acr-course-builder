import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, CircleDashed, RefreshCw, ArrowLeft } from 'lucide-react';
import {
  generalRequirements,
  requestChecklist,
  type ChecklistItem,
} from '../../entities/course/model/checklist';
import { useCommand, useCourse } from '../../entities/course/api/provider';
import {
  Form,
  Badge,
  Empty,
  ErrorMessage,
  Field,
  Loading,
  Notice,
  Panel,
  statuses,
} from '../../shared/ui/ui';
import { decisionQueue, programVerdict } from '../../entities/course/model/rules';
import { issueState } from '../course-plan/decision-queue';
import './audit.css';
const checklistStatuses: Record<ChecklistItem['status'], string> = {
  passed: 'Пройдено',
  problem: 'Проблема',
  not_checked: 'Не проверено',
};
export function AuditPage() {
  const query = useCourse();
  const command = useCommand();
  const navigate = useNavigate();
  const location = useLocation();
  const section = location.hash.slice(1);
  const tab =
    section.startsWith('issue-') || section === 'audit-findings'
      ? 'audit-findings'
      : section === 'audit-observation' || section === 'audit-checks'
        ? section
        : 'audit-checklist';
  useEffect(() => {
    if (!section.startsWith('issue-') || !query.data?.snapshot) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(section)?.scrollIntoView({ block: 'center' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [section, query.data]);
  const form = useForm<{ message: string; element_id: string; blocking: boolean }>({
    mode: 'onChange',
    defaultValues: { message: '', element_id: 'why-reachability', blocking: false },
  });
  const [correction, setCorrection] = useState('');
  if (query.isPending) return <Loading />;
  if (!query.data) return <ErrorMessage error={query.error} />;
  const view = query.data;
  const snapshot = view.snapshot;
  if (!snapshot) return <Empty title="Проверять пока нечего">Завершите уточнения.</Empty>;
  const suffix = view.is_latest ? '' : `?version=${snapshot.course_version}`;
  const general = generalRequirements(snapshot);
  const request = requestChecklist(snapshot);
  const all = [...general, ...request];
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
            обязательных разделов. «Не проверено» означает, что не хватает источника или материалов.
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
      <button className="link-button" onClick={() => navigate(-1)}>
        <ArrowLeft size={15} />
        Вернуться к месту просмотра
      </button>
      <nav className="audit-nav" aria-label="Разделы проверки программы">
        {(
          [
            ['audit-checklist', 'Чек-лист', count('problem')],
            ['audit-findings', 'Находки аудита', programVerdict(snapshot).open],
            ['audit-checks', 'Технические проверки', 0],
            ['audit-observation', 'Замечание методиста', snapshot.observations.length],
          ] as const
        ).map(([id, title, count]) => (
          <Link
            key={id}
            replace
            to={{ search: location.search, hash: `#${id}` }}
            aria-label={title}
            aria-current={tab === id ? 'page' : undefined}
          >
            {title}
            {count > 0 && <span className="tab-count">{count}</span>}
          </Link>
        ))}
      </nav>
      <section
        id="audit-findings"
        className="audit-section"
        aria-label="Находки аудита"
        hidden={tab !== 'audit-findings'}
      >
        <p>Блокируют утверждение: {programVerdict(snapshot).open}</p>
        {decisionQueue(snapshot.audit.issues).map((issue) => (
          <article id={`issue-${issue.id}`} key={issue.id} tabIndex={-1}>
            <Panel title={issue.message}>
              <Badge tone={issueState(issue).tone}>{issueState(issue).label}</Badge>
              <p>
                {issue.evidence || `Ожидается: ${issue.expected}. Фактически: ${issue.actual}.`}
              </p>
              <p>{issue.suggested_fix}</p>
              {issue.decision && <p>Причина решения: {issue.decision.reason}</p>}
            </Panel>
          </article>
        ))}
        {!snapshot.audit.issues.length && <Notice>Находок аудита нет.</Notice>}
      </section>
      <section
        id="audit-checklist"
        className="audit-section"
        aria-label="Чек-лист"
        hidden={tab !== 'audit-checklist'}
      >
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
        ).map(([title, subtitle, items]) => (
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
      <section
        id="audit-checks"
        className="audit-section"
        aria-label="Результаты проверок"
        hidden={tab !== 'audit-checks'}
      >
        <div className="audit-grid">
          {snapshot.audit.checks.map((check) => (
            <Panel key={check.id}>
              {check.status === 'passed' ? (
                <CheckCircle2 className="green-icon" size={22} />
              ) : check.status === 'failed' ? (
                <AlertTriangle className="red-icon" size={22} />
              ) : (
                <CircleDashed size={22} />
              )}
              <h3>{check.title}</h3>
              <Badge
                tone={
                  check.status === 'passed'
                    ? 'green'
                    : check.status === 'failed'
                      ? 'red'
                      : 'neutral'
                }
              >
                {statuses[check.status]}
              </Badge>
              <p>
                <b>Ожидается:</b> {check.expected}
              </p>
              <p>
                <b>Фактически:</b> {check.actual}
              </p>
            </Panel>
          ))}
        </div>
      </section>
      <section
        id="audit-observation"
        className="audit-section"
        aria-label="Замечание методиста"
        hidden={tab !== 'audit-observation'}
      >
        <Panel
          title="Замечание методиста"
          subtitle="Наблюдение хранится отдельно от утверждённого содержимого. Блокирующее замечание остановит продолжение, даже если утверждённая версия не менялась."
        >
          <Form
            errors={form.formState.errors}
            submitCount={form.formState.submitCount}
            onSubmit={form.handleSubmit(async (values) => {
              try {
                await command.mutateAsync({
                  action: 'record_observation',
                  expected_version: snapshot.course_version,
                  payload: values,
                });
                form.reset();
              } catch {
                /* Замечание остаётся доступным при ошибке. */
              }
            })}
          >
            <Field label="Связанный элемент">
              <select {...form.register('element_id')}>
                {snapshot.skeleton.explanations.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
                {snapshot.materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Конкретное замечание">
              <textarea {...form.register('message')} rows={3} required />
            </Field>
            <label className="checkbox">
              <input type="checkbox" {...form.register('blocking')} /> Ставит под сомнение основание
              каркаса и блокирует продолжение
            </label>
            <button type="submit" disabled={!view.is_latest || command.isPending}>
              Записать замечание
            </button>
          </Form>
          {snapshot.observations.length > 0 && (
            <div>
              <Field label="Исправление основания (создаёт новую ревизию)">
                <textarea
                  value={correction}
                  onChange={(e) => setCorrection(e.target.value)}
                  rows={3}
                />
              </Field>
              {snapshot.observations.map((issue) => (
                <div key={issue.id}>
                  <p>{issue.message}</p>
                  <button
                    disabled={!view.is_latest || !correction.trim() || command.isPending}
                    onClick={() =>
                      command.mutate({
                        action: 'resolve_observation',
                        expected_version: snapshot.course_version,
                        payload: { issue_id: issue.id, correction },
                      })
                    }
                  >
                    Сохранить исправление этого основания
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>
      <Notice>
        Предметный эксперт и методист пока не участвовали в приёмке. Модельный аудит не выполнен;
        экспертное одобрение отсутствует. Все комплекты остаются черновиками.
      </Notice>
      <ErrorMessage error={command.error} />
    </>
  );
}
