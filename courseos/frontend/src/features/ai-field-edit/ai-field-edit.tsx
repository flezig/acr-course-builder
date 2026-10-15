import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, X } from 'lucide-react';
import { useApi } from '../../entities/course/api/provider';
import type { FieldEditProposal } from '../../entities/course/api/contract';
import { ErrorMessage } from '../../shared/ui/ui';
import './ai-field-edit.css';

type EditableControl = HTMLInputElement | HTMLTextAreaElement;
const textInputTypes = ['text', 'number', ''];

// Помощник подключается один раз в макете и работает с любым текстовым полем,
// поэтому новые формы получают ИИ-правку без изменений в их коде.
// Поле можно исключить атрибутом data-ai-edit="off".
function isEditable(element: EventTarget | null): element is EditableControl {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  return (
    element instanceof HTMLInputElement &&
    textInputTypes.includes(element.getAttribute('type') || '') &&
    !element.disabled &&
    !element.readOnly &&
    element.dataset.aiEdit !== 'off'
  );
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

export function AiFieldEdit() {
  const { api } = useApi();
  const { courseId } = useParams();
  const location = useLocation();
  const [focused, setFocused] = useState<EditableControl | null>(null);
  const [target, setTarget] = useState<EditableControl | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [request, setRequest] = useState('');
  const [proposal, setProposal] = useState<FieldEditProposal | null>(null);
  const [baseValue, setBaseValue] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const propose = useMutation({
    mutationFn: (control: EditableControl) =>
      api.proposeFieldEdit({
        course_id: courseId || null,
        field_label: fieldLabel(control),
        page: location.pathname,
        current_value: control.value,
        request,
      }),
    onSuccess: (result) => setProposal(result),
  });

  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      if (dialogRef.current?.contains(event.target as Node)) return;
      setFocused(isEditable(event.target) ? event.target : null);
    };
    const onBlur = () => setFocused(null);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
    };
  }, []);

  const anchor = target || focused;
  useEffect(() => {
    if (!anchor) return setRect(null);
    const update = () => setRect(anchor.isConnected ? anchor.getBoundingClientRect() : null);
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor]);

  useEffect(() => close(), [location.pathname]);

  function close() {
    setTarget(null);
    setProposal(null);
    setRequest('');
    propose.reset();
  }

  if (!anchor || !rect) return null;
  if (!target)
    return (
      <button
        type="button"
        className="ai-field-trigger"
        style={{ top: rect.top + 4, left: rect.right - 62 }}
        title="Изменить с помощью ИИ"
        aria-label={`Изменить поле «${fieldLabel(anchor)}» с помощью ИИ`}
        // Не забираем фокус у поля, иначе кнопка исчезнет до клика.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setTarget(anchor);
          setBaseValue(anchor.value);
        }}
      >
        <Sparkles size={14} />
        ИИ
      </button>
    );

  // Окно открывается под полем, а если места внизу мало — над ним.
  const spaceBelow = window.innerHeight - rect.bottom;
  const openAbove = spaceBelow < 320 && rect.top > spaceBelow;
  const position = openAbove
    ? { bottom: window.innerHeight - rect.top + 6, maxHeight: rect.top - 14 }
    : { top: rect.bottom + 6, maxHeight: spaceBelow - 14 };
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 408));
  return (
    <div
      ref={dialogRef}
      className="ai-field-dialog"
      role="dialog"
      aria-label="Правка поля с помощью ИИ"
      style={{ ...position, left }}
      onKeyDown={(event) => event.key === 'Escape' && close()}
    >
      <div className="ai-field-heading">
        <Sparkles size={16} />
        <strong>{fieldLabel(target)}</strong>
        <button type="button" className="ai-field-close" aria-label="Закрыть" onClick={close}>
          <X size={16} />
        </button>
      </div>
      {!proposal ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (request.trim()) propose.mutate(target);
          }}
        >
          <textarea
            autoFocus
            rows={3}
            value={request}
            data-ai-edit="off"
            placeholder="Например: сформулируй через наблюдаемое действие и добавь критерий"
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                event.currentTarget.form?.requestSubmit();
            }}
          />
          <button className="primary" type="submit" disabled={!request.trim() || propose.isPending}>
            {propose.isPending ? 'ИИ готовит вариант…' : 'Предложить вариант'}
          </button>
        </form>
      ) : (
        <div className="ai-field-proposal">
          <div className="diff-grid">
            <div>
              <span>БЫЛО</span>
              <pre>{baseValue || '—'}</pre>
            </div>
            <div>
              <span>ПРЕДЛАГАЕТСЯ</span>
              <pre>{proposal.value || '—'}</pre>
            </div>
          </div>
          {proposal.note && <small className="muted">{proposal.note}</small>}
          {target.value !== baseValue && (
            <small className="muted">
              Поле изменилось после запроса — предложение заменит его целиком.
            </small>
          )}
          <div className="actions">
            <button
              className="primary"
              type="button"
              disabled={!target.isConnected}
              onClick={() => {
                writeValue(target, proposal.value);
                target.focus();
                close();
              }}
            >
              Подставить в поле
            </button>
            <button type="button" onClick={() => setProposal(null)}>
              Уточнить запрос
            </button>
          </div>
          <small className="muted">
            Значение попадёт в форму; сохранение — как обычно, вашей кнопкой.
          </small>
        </div>
      )}
      <ErrorMessage error={propose.error} />
    </div>
  );
}
