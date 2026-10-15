import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, X } from 'lucide-react';
import { useApi } from '../../entities/course/api/provider';
import type { PageEditProposal } from '../../entities/course/api/contract';
import { ErrorMessage, Notice } from '../../shared/ui/ui';
import './ai-page-edit.css';

type EditableControl = HTMLInputElement | HTMLTextAreaElement;
interface PageField {
  id: string;
  label: string;
  value: string;
  control: EditableControl;
}

// Помощник подключён один раз в макете и находит поля в DOM, поэтому любая
// форма, открытая на редактирование, доступна ему без изменений в её коде.
// Поле можно исключить атрибутом data-ai-edit="off".
function collectFields(): PageField[] {
  const controls = document.querySelectorAll<EditableControl>(
    'main textarea, main input:not([type]), main input[type="text"], main input[type="number"]',
  );
  return Array.from(controls)
    .filter(
      (control) =>
        !control.disabled &&
        !control.readOnly &&
        control.dataset.aiEdit !== 'off' &&
        control.offsetParent !== null,
    )
    .map((control, index) => ({
      id: `field-${index + 1}`,
      label: fieldLabel(control),
      value: control.value,
      control,
    }));
}

function fieldLabel(control: EditableControl) {
  const label =
    control.labels?.[0]?.textContent ||
    control.getAttribute('aria-label') ||
    control.closest('.field')?.querySelector('.field-label')?.textContent ||
    control.placeholder;
  return label?.trim() || control.name || 'Поле формы';
}

// Через нативный setter значение доходит и до react-hook-form, и до
// контролируемых полей: React отслеживает событие input, а не присваивание value.
function writeValue(control: EditableControl, value: string) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

export function AiPageEdit() {
  const { api } = useApi();
  const { courseId } = useParams();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState('');
  const [fields, setFields] = useState<PageField[]>([]);
  const [proposal, setProposal] = useState<PageEditProposal | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const propose = useMutation({
    mutationFn: (pageFields: PageField[]) =>
      api.proposePageEdit({
        course_id: courseId || null,
        page: location.pathname + location.hash,
        request,
        fields: pageFields.map(({ id, label, value }) => ({ id, label, value })),
      }),
    onSuccess: (result) => {
      setProposal(result);
      setRejected(new Set());
    },
  });

  useEffect(() => setOpen(false), [location.pathname]);

  function close() {
    setOpen(false);
    setProposal(null);
    propose.reset();
    triggerRef.current?.focus();
  }

  function submit() {
    const pageFields = collectFields();
    setFields(pageFields);
    if (pageFields.length && request.trim()) propose.mutate(pageFields);
  }

  function apply() {
    for (const change of proposal!.changes) {
      const field = fields.find((item) => item.id === change.field_id);
      if (field?.control.isConnected && !rejected.has(change.field_id))
        writeValue(field.control, change.value);
    }
    setRequest('');
    close();
  }

  if (!open)
    return (
      <button
        ref={triggerRef}
        type="button"
        className="ai-page-trigger"
        onClick={() => {
          setFields(collectFields());
          setOpen(true);
        }}
      >
        <Sparkles size={16} />
        Изменить с ИИ
      </button>
    );

  const changes = proposal?.changes.filter((change) =>
    fields.some((field) => field.id === change.field_id),
  );
  return (
    <div
      className="ai-page-dialog"
      role="dialog"
      aria-label="Правка с помощью ИИ"
      onKeyDown={(event) => event.key === 'Escape' && close()}
    >
      <div className="ai-page-heading">
        <Sparkles size={16} />
        <strong>Изменить с помощью ИИ</strong>
        <button type="button" className="ai-page-close" aria-label="Закрыть" onClick={close}>
          <X size={16} />
        </button>
      </div>
      {!proposal ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {fields.length ? (
            <small className="muted">
              ИИ видит открытые для редактирования поля: {fields.length}.
            </small>
          ) : (
            <Notice tone="warning">
              Сейчас нет открытых полей. Нажмите «Изменить» у нужного раздела, затем опишите правку.
            </Notice>
          )}
          <textarea
            autoFocus
            rows={4}
            value={request}
            placeholder="Например: переформулируй результаты обучения через наблюдаемые действия"
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                event.currentTarget.form?.requestSubmit();
            }}
          />
          <button className="primary" type="submit" disabled={!request.trim() || propose.isPending}>
            {propose.isPending ? 'ИИ готовит правки…' : 'Предложить правки'}
          </button>
        </form>
      ) : (
        <div className="ai-page-proposal">
          {proposal.note && <small className="muted">{proposal.note}</small>}
          {!changes?.length && <Notice>ИИ не предложил изменений.</Notice>}
          {changes?.map((change) => {
            const field = fields.find((item) => item.id === change.field_id)!;
            return (
              <label className="ai-page-change" key={change.field_id}>
                <span className="checkbox">
                  <input
                    type="checkbox"
                    checked={!rejected.has(change.field_id)}
                    onChange={(event) => {
                      const next = new Set(rejected);
                      if (event.target.checked) next.delete(change.field_id);
                      else next.add(change.field_id);
                      setRejected(next);
                    }}
                  />
                  <strong>{field.label}</strong>
                </span>
                <div className="diff-grid">
                  <div>
                    <span>БЫЛО</span>
                    <pre>{field.value || '—'}</pre>
                  </div>
                  <div>
                    <span>ПРЕДЛАГАЕТСЯ</span>
                    <pre>{change.value || '—'}</pre>
                  </div>
                </div>
              </label>
            );
          })}
          <div className="actions">
            <button
              className="primary"
              type="button"
              disabled={!changes?.some((change) => !rejected.has(change.field_id))}
              onClick={apply}
            >
              Подставить выбранное
            </button>
            <button type="button" onClick={() => setProposal(null)}>
              Уточнить запрос
            </button>
          </div>
          <small className="muted">Значения попадут в формы; сохраняете их вы, как обычно.</small>
        </div>
      )}
      <ErrorMessage error={propose.error} />
    </div>
  );
}
