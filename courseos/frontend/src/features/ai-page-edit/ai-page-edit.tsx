import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Check, Sparkles, Undo2, X } from 'lucide-react';
import { useApi, useCommand, useCourse } from '../../entities/course/api/provider';
import type { EditScope, ScopeEditProposal } from '../../entities/course/api/contract';
import type { Skeleton } from '../../entities/course/model/schema';
import { ErrorMessage, Notice } from '../../shared/ui/ui';
import { wordDiff } from './word-diff';
import './ai-page-edit.css';

const scopeTitles: Record<EditScope, string> = {
  intent: 'О программе',
  curriculum: 'Учебный план',
  calendar: 'Календарь',
  outcomes: 'Карта результатов',
  materials: 'Материалы и выгрузки',
};

// Повторяет выбор вкладки из pages/course-plan/page.tsx: ИИ правит ровно то,
// что методист сейчас видит. Вкладки без редактируемой программы не дают кнопку.
function editScope(pathname: string, hash: string): EditScope | null {
  if (pathname.endsWith('/map')) return 'outcomes';
  // Материалы и выгрузки собираются из тем, практик и заданий каркаса,
  // поэтому ИИ правит эти тексты, а материалы пересобираются после сохранения.
  if (pathname.endsWith('/materials')) return 'materials';
  if (!pathname.endsWith('/plan')) return null;
  const target = decodeURIComponent(hash.slice(1)).replace(/^fix-/, '').split('~')[0];
  if (target === 'review' || target === 'approve' || target.startsWith('issue-')) return null;
  if (target === 'calendar') return 'calendar';
  if (
    !target ||
    target === 'curriculum' ||
    target.startsWith('coverage') ||
    target.startsWith('topic-')
  )
    return 'curriculum';
  return 'intent';
}

const sectionLabels: Record<string, string> = {
  goal: 'Цель',
  tasks: 'Задача',
  outcomes: 'Результат',
  topics: 'Тема',
  activities: 'Активность',
  assessments: 'Оценивание',
  action: 'действие',
  criterion: 'критерий',
  requirements: 'Параметры',
  audience: 'аудитория',
  entry_level: 'входной уровень',
  calendar: 'календарь',
  title: 'название',
  content: 'содержание',
  description: 'описание',
};

/** Изменённые тексты каркаса с понятными подписями вроде «Результат 2 · описание». */
interface TextChange {
  path: (string | number)[];
  label: string;
  before: string;
  after: string;
}
function changedTexts(
  before: unknown,
  after: unknown,
  path: (string | number)[] = [],
): TextChange[] {
  if (typeof after === 'string' || typeof before === 'string')
    return before === after
      ? []
      : [
          {
            path,
            label: textLabel(path),
            before: String(before ?? ''),
            after: String(after ?? ''),
          },
        ];
  if (!after || typeof after !== 'object') return [];
  const changes: TextChange[] = [];
  for (const [key, value] of Object.entries(after)) {
    const previous = (before as Record<string, unknown> | undefined)?.[key];
    changes.push(...changedTexts(previous, value, [...path, Array.isArray(after) ? +key : key]));
  }
  return changes;
}

/** Исходный каркас с подставленными только принятыми текстами. */
function withAccepted(skeleton: Skeleton, accepted: TextChange[]) {
  const result = structuredClone(skeleton);
  for (const change of accepted) {
    let node = result as unknown as Record<string | number, unknown>;
    for (const key of change.path.slice(0, -1))
      node = node[key] as Record<string | number, unknown>;
    node[change.path[change.path.length - 1]] = change.after;
  }
  return result;
}

function DiffLines({ before, after }: { before: string; after: string }) {
  const { removed, added } = wordDiff(before, after);
  return (
    <div className="gh-diff">
      {before && (
        <div className="gh-line removed">
          <span className="gh-sign">−</span>
          <span>
            {removed.map((part, index) =>
              part.changed ? <del key={index}>{part.text}</del> : part.text,
            )}
          </span>
        </div>
      )}
      {after && (
        <div className="gh-line added">
          <span className="gh-sign">+</span>
          <span>
            {added.map((part, index) =>
              part.changed ? <ins key={index}>{part.text}</ins> : part.text,
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function textLabel(path: (string | number)[]) {
  const parts: string[] = [];
  for (const part of path) {
    if (typeof part === 'number') parts[parts.length - 1] += ` ${part + 1}`;
    else parts.push(sectionLabels[part] || part);
  }
  return parts.join(' · ');
}

export function AiPageEdit() {
  const { api } = useApi();
  const location = useLocation();
  const course = useCourse();
  const command = useCommand();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState('');
  const [proposal, setProposal] = useState<ScopeEditProposal | null>(null);
  const [saved, setSaved] = useState('');
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'reject'>>({});
  const scope = editScope(location.pathname, location.hash);
  const snapshot = course.data?.snapshot;
  const propose = useMutation({
    mutationFn: (input: { scope: EditScope; skeleton: Skeleton; version: number }) =>
      api.proposeScopeEdit({
        course_id: snapshot!.course_id,
        course_version: input.version,
        scope: input.scope,
        request,
        skeleton: input.skeleton,
      }),
    onSuccess: (result) => {
      setProposal(result);
      setDecisions({});
    },
  });

  useEffect(() => {
    setProposal(null);
    setSaved('');
    propose.reset();
    // Смена вкладки меняет область правки, старое предложение к ней не относится.
  }, [scope, location.pathname]);

  if (!scope || !snapshot) return null;
  const readonly =
    !course.data?.is_latest || ['queued', 'running'].includes(course.data.job.status);

  function close() {
    setOpen(false);
    setProposal(null);
    setSaved('');
    propose.reset();
    command.reset();
  }

  async function apply(accepted: TextChange[]) {
    try {
      await command.mutateAsync({
        action: 'save_skeleton',
        expected_version: snapshot!.course_version,
        payload: withAccepted(snapshot!.skeleton, accepted),
      });
      setProposal(null);
      setRequest('');
      setSaved('Изменения сохранены. Проверки пересчитаны.');
    } catch {
      /* Предложение остаётся на экране, ошибка показана ниже. */
    }
  }

  if (!open)
    return (
      <button
        type="button"
        className="ai-page-trigger"
        onClick={() => {
          setOpen(true);
          // В демо сразу показываем пример, чтобы было видно, как выглядит правка.
          if (api.mode === 'demo' && !readonly)
            propose.mutate({
              scope,
              skeleton: snapshot.skeleton,
              version: snapshot.course_version,
            });
        }}
      >
        <Sparkles size={16} />
        Изменить с ИИ
      </button>
    );

  const changes = proposal ? changedTexts(snapshot.skeleton, proposal.skeleton) : [];
  const accepted = changes.filter((change) => decisions[change.label] === 'accept');
  const undecided = changes.filter((change) => !decisions[change.label]).length;
  const decide = (label: string, decision: 'accept' | 'reject') =>
    setDecisions((previous) => ({ ...previous, [label]: decision }));
  return (
    <div
      className="ai-page-dialog"
      role="dialog"
      aria-label="Правка с помощью ИИ"
      onKeyDown={(event) => event.key === 'Escape' && close()}
    >
      <div className="ai-page-heading">
        <Sparkles size={16} />
        <strong>ИИ · {scopeTitles[scope]}</strong>
        <button type="button" className="ai-page-close" aria-label="Закрыть" onClick={close}>
          <X size={16} />
        </button>
      </div>
      {saved && <Notice tone="success">{saved}</Notice>}
      {readonly && (
        <Notice tone="warning">Править можно только актуальную версию программы.</Notice>
      )}
      {!proposal ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (request.trim())
              propose.mutate({
                scope,
                skeleton: snapshot.skeleton,
                version: snapshot.course_version,
              });
          }}
        >
          <textarea
            autoFocus
            rows={4}
            value={request}
            disabled={readonly}
            placeholder={`Что поменять во вкладке «${scopeTitles[scope]}»?`}
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                event.currentTarget.form?.requestSubmit();
            }}
          />
          <button
            className="primary"
            type="submit"
            disabled={readonly || !request.trim() || propose.isPending}
          >
            {propose.isPending ? 'ИИ готовит правки…' : 'Предложить правки'}
          </button>
        </form>
      ) : (
        <div className="ai-page-proposal">
          {proposal.note && <small className="muted">{proposal.note}</small>}
          {!changes.length && <Notice>ИИ не предложил изменений в текстах.</Notice>}
          {changes.map((change) => {
            const decision = decisions[change.label];
            return (
              <div className={`gh-file ${decision || ''}`} key={change.label}>
                <div className="gh-file-header">
                  <strong>{change.label}</strong>
                  {decision ? (
                    <>
                      <span className={`gh-verdict ${decision}`}>
                        {decision === 'accept' ? 'Новая версия' : 'Оставлено как было'}
                      </span>
                      <button
                        type="button"
                        className="gh-undo"
                        aria-label={`Отменить решение: ${change.label}`}
                        onClick={() => setDecisions(({ [change.label]: _, ...rest }) => rest)}
                      >
                        <Undo2 size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="gh-accept"
                        onClick={() => decide(change.label, 'accept')}
                      >
                        <Check size={14} /> Утвердить
                      </button>
                      <button
                        type="button"
                        className="gh-reject"
                        onClick={() => decide(change.label, 'reject')}
                      >
                        <X size={14} /> Оставить
                      </button>
                    </>
                  )}
                </div>
                <DiffLines before={change.before} after={change.after} />
              </div>
            );
          })}
          <div className="actions">
            <button
              className="primary"
              type="button"
              disabled={readonly || command.isPending || undecided > 0 || !accepted.length}
              onClick={() => void apply(accepted)}
            >
              {command.isPending
                ? 'Сохраняем…'
                : `Сохранить утверждённое (${accepted.length} из ${changes.length})`}
            </button>
            <button type="button" onClick={() => setProposal(null)}>
              {api.mode === 'demo' && !request ? 'Написать свой запрос' : 'Уточнить запрос'}
            </button>
          </div>
          {undecided > 0 && <small className="muted">Осталось решить по полям: {undecided}.</small>}
        </div>
      )}
      <ErrorMessage error={propose.error || command.error} />
    </div>
  );
}
