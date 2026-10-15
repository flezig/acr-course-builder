import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, CircleDashed, RefreshCw, ArrowLeft } from 'lucide-react';
import { skeletonElements } from '../../entities/course/model/rationale';
import { materialLabels } from '../../entities/course/model/presets';
import { useCommand, useCourse } from '../../entities/course/api/provider';
import {
  Badge,
  Empty,
  ErrorMessage,
  Field,
  Loading,
  Notice,
  Panel,
  statuses,
} from '../../shared/ui/ui';
import './audit.css';
export function AuditPage() {
  const query = useCourse();
  const command = useCommand();
  const navigate = useNavigate();
  const location = useLocation();
  const section = location.hash.slice(1);
  const tab =
    section === 'audit-observation'
      ? 'audit-observation'
      : section === 'audit-issues' || section.startsWith('issue-')
        ? 'audit-issues'
        : 'audit-checks';
  const form = useForm<{ message: string; element_id: string; blocking: boolean }>({
    defaultValues: { message: '', element_id: 'why-reachability', blocking: false },
  });
  const [correction, setCorrection] = useState('');
  if (query.isPending) return <Loading />;
  if (!query.data) return <ErrorMessage error={query.error} />;
  const view = query.data;
  const snapshot = view.snapshot;
  if (!snapshot) return <Empty title="Проверять пока нечего">Завершите уточнения.</Empty>;
  const suffix = view.is_latest ? '' : `?version=${snapshot.course_version}`;
  const sectionNames: Record<string, string> = {
    calendar: 'Календарь',
    legal: 'Нормативные основания',
    goal: 'Цель программы',
    requirements: 'Параметры программы',
    map: 'Карта результатов',
    hours: 'Объём программы',
    audience: 'Аудитория',
    entry_level: 'Входной уровень',
    constraints: 'Ограничения',
  };
  const elements = skeletonElements(snapshot.skeleton);
  const targetName = (id: string) => {
    const assessment = snapshot.skeleton.assessments.find(
      (item) => item.id === id || `criterion:${item.id}` === id,
    );
    return (
      sectionNames[id] ||
      snapshot.materials.find((item) => item.id === id)?.title ||
      snapshot.sources.find((item) => item.id === id)?.name ||
      snapshot.skeleton.explanations.find((item) => item.id === id)?.title ||
      (assessment &&
        (id === assessment.id ? materialLabels[assessment.type] : 'Критерий проверки')) ||
      elements.find((item) => item.id === id)?.title ||
      'Связанный раздел'
    );
  };
  const target = (id: string) =>
    id.startsWith('outcome') ||
    id.startsWith('assessment') ||
    snapshot.sources.some((s) => s.id === id)
      ? `/courses/${snapshot.course_id}/map${suffix}#${id}`
      : snapshot.materials.some((m) => m.id === id)
        ? `/courses/${snapshot.course_id}/materials?${view.is_latest ? '' : `version=${snapshot.course_version}&`}material=${id}`
        : `/courses/${snapshot.course_id}/plan${suffix}#${id}`;
  return (
    <>
      <header className="page-heading heading-action">
        <div>
          <h1>Проверка программы и материалов</h1>
          <p>Расчёты и структурные проверки отделены от содержательной экспертизы.</p>
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
            ['audit-checks', 'Результаты проверок', 0],
            ['audit-issues', 'Замечания и следующий шаг', snapshot.audit.issues.length],
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
        id="audit-issues"
        className="audit-section"
        aria-label="Замечания и следующий шаг"
        hidden={tab !== 'audit-issues'}
      >
        <Panel
          title="Замечания и следующий шаг"
          subtitle={`Отчёт от ${new Date(snapshot.audit.at).toLocaleString('ru-RU')} · версия ${snapshot.audit.course_version}`}
        >
          {snapshot.audit.issues.length === 0 && (
            <Notice tone="success">
              Вычислимых ошибок не обнаружено. Экспертная проверка ещё не выполнена.
            </Notice>
          )}
          {snapshot.audit.issues.map((issue) => (
            <div className="audit-issue" key={issue.id} id={`issue-${issue.id}`}>
              <div className="toolbar">
                <Badge tone={issue.severity === 'error' ? 'red' : 'amber'}>
                  {issue.severity === 'error'
                    ? 'Ошибка'
                    : issue.severity === 'warning'
                      ? 'Предупреждение'
                      : 'Наблюдение'}
                </Badge>
                <Badge>
                  {issue.check_type === 'rule'
                    ? 'Правило'
                    : issue.check_type === 'human'
                      ? 'Для проверки человеком'
                      : 'Модель'}
                </Badge>
                {issue.blocking && <Badge tone="red">Блокирует продолжение</Badge>}
              </div>
              <h3>{issue.message}</h3>
              <p>
                Ожидается: {issue.expected}. Фактически: {issue.actual}.
              </p>
              <p>{issue.suggested_fix}</p>
              <Link to={target(issue.element_id)}>
                Открыть «{targetName(issue.element_id)}» и исправить ↗
              </Link>
            </div>
          ))}
        </Panel>
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
          <form
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
          </form>
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
