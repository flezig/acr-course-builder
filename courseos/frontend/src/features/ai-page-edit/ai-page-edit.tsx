import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, X } from 'lucide-react';
import { useApi, useCommand, useCourse } from '../../entities/course/api/provider';
import type { EditScope, ScopeEditProposal } from '../../entities/course/api/contract';
import type { Skeleton } from '../../entities/course/model/schema';
import { ErrorMessage, Notice } from '../../shared/ui/ui';
import './ai-page-edit.css';

const scopeTitles: Record<EditScope, string> = {
  intent: 'О программе',
  curriculum: 'Учебный план',
  calendar: 'Календарь',
  outcomes: 'Карта результатов',
};

// Повторяет выбор вкладки из pages/course-plan/page.tsx: ИИ правит ровно то,
// что методист сейчас видит. Вкладки без редактируемой программы не дают кнопку.
function editScope(pathname: string, hash: string): EditScope | null {
  if (pathname.endsWith('/map')) return 'outcomes';
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
  requirements: 'Параметры',
  audience: 'аудитория',
  entry_level: 'входной уровень',
  calendar: 'календарь',
  title: 'название',
  content: 'содержание',
  description: 'описание',
};

/** Изменённые тексты каркаса с понятными подписями вроде «Результат 2 · описание». */
function changedTexts(before: unknown, after: unknown, path: (string | number)[] = []) {
  if (typeof after === 'string' || typeof before === 'string')
    return before === after
      ? []
      : [{ label: textLabel(path), before: String(before ?? ''), after: String(after ?? '') }];
  if (!after || typeof after !== 'object') return [];
  const changes: { label: string; before: string; after: string }[] = [];
  for (const [key, value] of Object.entries(after)) {
    const previous = (before as Record<string, unknown> | undefined)?.[key];
    changes.push(...changedTexts(previous, value, [...path, Array.isArray(after) ? +key : key]));
  }
  return changes;
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
    onSuccess: setProposal,
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

  async function apply() {
    try {
      await command.mutateAsync({
        action: 'save_skeleton',
        expected_version: snapshot!.course_version,
        payload: proposal!.skeleton,
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
      <button type="button" className="ai-page-trigger" onClick={() => setOpen(true)}>
        <Sparkles size={16} />
        Изменить с ИИ
      </button>
    );

  const changes = proposal ? changedTexts(snapshot.skeleton, proposal.skeleton) : [];
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
          {changes.map((change) => (
            <div className="ai-page-change" key={change.label}>
              <strong>{change.label}</strong>
              <div className="diff-grid">
                <div>
                  <span>БЫЛО</span>
                  <pre>{change.before || '—'}</pre>
                </div>
                <div>
                  <span>СТАНЕТ</span>
                  <pre>{change.after || '—'}</pre>
                </div>
              </div>
            </div>
          ))}
          <div className="actions">
            <button
              className="primary"
              type="button"
              disabled={readonly || command.isPending}
              onClick={() => void apply()}
            >
              {command.isPending ? 'Сохраняем…' : 'Применить и сохранить'}
            </button>
            <button type="button" onClick={() => setProposal(null)}>
              Уточнить запрос
            </button>
          </div>
        </div>
      )}
      <ErrorMessage error={propose.error || command.error} />
    </div>
  );
}
