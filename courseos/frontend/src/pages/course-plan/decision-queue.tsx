import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import { useCommand } from '../../entities/course/api/provider';
import { fixConsequences } from '../../entities/course/model/finding-consequences';
import { Badge, ErrorMessage, Notice } from '../../shared/ui/ui';

type Issue = Snapshot['audit']['issues'][number];

export function issueState(issue: Issue) {
  if (issue.decision) return { label: 'Оставлено как есть', tone: 'neutral' };
  if (!issue.blocking) return { label: 'К сведению', tone: 'neutral' };
  return issue.dismissible
    ? { label: 'Нужно решение', tone: 'amber' }
    : { label: 'Блокирует утверждение', tone: 'red' };
}

// Очередь решений методиста: каждая находка показана как
// «проблема → доказательство → предложение → действие».
export function DecisionQueue({
  snapshot,
  target,
  readonly,
  issuePlace,
  issueHref,
  onDecided,
}: {
  snapshot: Snapshot;
  target: string;
  readonly: boolean;
  issuePlace: (id: string) => string;
  issueHref: (id: string, issueId: string) => string;
  onDecided: (message: string) => void;
}) {
  const issues = snapshot.audit.issues;
  if (!issues.length)
    return (
      <Notice tone="success">
        Проблем и находок нет. Проверьте содержание и обоснования перед утверждением.
      </Notice>
    );
  const groups = [
    { title: 'Блокирует утверждение', items: issues.filter((i) => !i.decision && i.blocking) },
    { title: 'К сведению', items: issues.filter((i) => !i.decision && !i.blocking) },
    { title: 'Решено методистом', items: issues.filter((i) => i.decision) },
  ].filter((group) => group.items.length);
  return (
    <div className="decision-queue">
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3 className="queue-group">
            {group.title} <span>{group.items.length}</span>
          </h3>
          <ol>
            {group.items.map((issue) => (
              <DecisionItem
                key={issue.id}
                issue={issue}
                snapshot={snapshot}
                focused={target === `issue-${issue.id}`}
                readonly={readonly}
                groupTitle={group.title}
                place={issuePlace(issue.element_id)}
                href={issueHref(issue.element_id, issue.id)}
                onDecided={onDecided}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function DecisionItem({
  issue,
  snapshot,
  focused,
  readonly,
  groupTitle,
  place,
  href,
  onDecided,
}: {
  issue: Issue;
  snapshot: Snapshot;
  focused: boolean;
  readonly: boolean;
  groupTitle: string;
  place: string;
  href: string;
  onDecided: (message: string) => void;
}) {
  const command = useCommand();
  const [keeping, setKeeping] = useState(false);
  const [reason, setReason] = useState('');
  const state = issueState(issue);
  const consequences = issue.decision ? [] : fixConsequences(snapshot, issue);
  const decide = async (action: 'apply_finding' | 'dismiss_finding') => {
    try {
      await command.mutateAsync(
        action === 'apply_finding'
          ? {
              action,
              expected_version: snapshot.course_version,
              payload: { issue_id: issue.id },
            }
          : {
              action,
              expected_version: snapshot.course_version,
              payload: { issue_id: issue.id, reason },
            },
      );
      setKeeping(false);
      onDecided(
        action === 'apply_finding'
          ? `Предложение применено: создана версия ${snapshot.course_version + 1}, проверки пересчитаны.`
          : 'Находка оставлена как есть. Причина сохранена в отчёте.',
      );
    } catch {
      /* Ошибка показана рядом с действием; причина остаётся в поле. */
    }
  };
  return (
    <li>
      <article
        className={`decision-item ${focused ? 'field-highlight' : ''}`}
        id={`issue-${issue.id}`}
        tabIndex={-1}
      >
        <div className="decision-heading">
          {/* Статус, совпадающий с заголовком группы, ничего не добавляет. */}
          {state.label !== groupTitle && <Badge tone={state.tone}>{state.label}</Badge>}
          <span className="issue-place">{place}</span>
        </div>
        <h4>{issue.message}</h4>
        <dl>
          <div>
            <dt>Что найдено</dt>
            <dd>
              {issue.evidence || `Ожидается: ${issue.expected}. Фактически: ${issue.actual}.`}
            </dd>
          </div>
          <div>
            <dt>{issue.fix ? 'Предложение агента' : 'Как исправить'}</dt>
            <dd>{issue.suggested_fix}</dd>
          </div>
          {!!consequences.length && (
            <div>
              <dt>Что изменится после «Применить»</dt>
              <dd>
                <ul className="fix-consequences">
                  {consequences.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {issue.dismissible && !issue.decision && (
            <div>
              <dt>Если оставить как есть</dt>
              <dd>
                Замечание перестанет блокировать утверждение, а ваша причина попадёт в отчёт о
                программе.
              </dd>
            </div>
          )}
          {issue.decision && (
            <div>
              <dt>Причина решения</dt>
              <dd>{issue.decision.reason}</dd>
            </div>
          )}
        </dl>
        {!issue.decision && (
          <div className="decision-actions">
            {issue.fix && (
              <button
                className="primary"
                disabled={readonly || command.isPending}
                onClick={() => void decide('apply_finding')}
              >
                <Check size={15} />
                Применить предложение
              </button>
            )}
            {issue.dismissible && !keeping && (
              <button disabled={readonly || command.isPending} onClick={() => setKeeping(true)}>
                Оставить как есть
              </button>
            )}
            <Link className="button secondary" to={href}>
              {issue.element_id === 'calendar'
                ? 'Исправить календарь вручную'
                : issue.fix
                  ? 'Исправить вручную'
                  : 'Открыть место в программе'}
              <ArrowRight size={15} />
            </Link>
          </div>
        )}
        {keeping && (
          <form
            className="keep-form"
            onSubmit={(event) => {
              event.preventDefault();
              void decide('dismiss_finding');
            }}
          >
            <label>
              Почему оставить как есть
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                required
                minLength={3}
                autoFocus
              />
            </label>
            <div className="decision-actions">
              <button
                type="submit"
                className="primary"
                disabled={reason.trim().length < 3 || command.isPending}
              >
                Сохранить решение
              </button>
              <button type="button" onClick={() => setKeeping(false)}>
                Отмена
              </button>
            </div>
          </form>
        )}
        <ErrorMessage error={command.error} />
      </article>
    </li>
  );
}
