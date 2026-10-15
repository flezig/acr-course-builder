import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { FieldErrors } from 'react-hook-form';
import { controlError, fieldError, focusInvalid, isFormControl } from '../lib/form-validation';

const ValidationContext = createContext<{
  errors: FieldErrors;
  nativeErrors: Record<string, string>;
}>({ errors: {}, nativeErrors: {} });

/** One validation presentation for both schema-driven and native forms. */
export function Form({
  errors = {},
  submitCount = 0,
  children,
  onSubmit,
  ref: externalRef,
  ...props
}: ComponentProps<'form'> & { errors?: FieldErrors; submitCount?: number }) {
  const ref = useRef<HTMLFormElement>(null);
  const [nativeErrors, setNativeErrors] = useState<Record<string, string>>({});
  useImperativeHandle(externalRef, () => ref.current!);
  const previousSubmit = useRef(submitCount);
  useEffect(() => {
    if (submitCount > previousSubmit.current && ref.current) focusInvalid(ref.current);
    previousSubmit.current = submitCount;
  }, [submitCount]);
  useEffect(() => {
    if (!ref.current) return;
    const active = new Set(
      Array.from(ref.current.elements)
        .filter(isFormControl)
        .filter((control) => !!controlError(control))
        .map((control) => control.name || control.id),
    );
    setNativeErrors((previous) => {
      const next = Object.fromEntries(Object.entries(previous).filter(([key]) => active.has(key)));
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
  });
  const validate = (target: unknown, blur = false) => {
    if (!isFormControl(target)) return;
    const key = target.name || target.id;
    if (!key) return;
    const message = !blur && !target.value && !nativeErrors[key] ? undefined : controlError(target);
    setNativeErrors((previous) => {
      if (previous[key] === message) return previous;
      const next = { ...previous };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  };
  return (
    <ValidationContext.Provider value={{ errors, nativeErrors }}>
      <form
        {...props}
        ref={ref}
        noValidate
        onChange={(event) => {
          validate(event.target);
          props.onChange?.(event);
        }}
        onBlur={(event) => {
          validate(event.target, true);
          props.onBlur?.(event);
        }}
        onReset={() => setNativeErrors({})}
        onSubmit={(event) => {
          const next: Record<string, string> = {};
          let first: import('../lib/form-validation').FormControl | undefined;
          for (const control of Array.from(event.currentTarget.elements)) {
            if (!isFormControl(control)) continue;
            const message = controlError(control);
            if (!message) continue;
            next[control.name || control.id] = message;
            first ||= control;
          }
          setNativeErrors(next);
          if (first) {
            event.preventDefault();
            focusInvalid(event.currentTarget, first);
            return;
          }
          void onSubmit?.(event);
        }}
      >
        {children}
      </form>
    </ValidationContext.Provider>
  );
}

export function Field({
  label,
  children,
  hint,
  error: explicitError,
  className = '',
}: {
  label?: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  className?: string;
}) {
  const id = useId();
  const { errors, nativeErrors } = useContext(ValidationContext);
  const items = Children.toArray(children);
  const control = items.find(
    (child) =>
      isValidElement(child) && ['input', 'textarea', 'select'].includes(String(child.type)),
  ) as ReactElement<ComponentProps<'input'>> | undefined;
  const name = control?.props.name || control?.props.id || id;
  const error = explicitError || nativeErrors[name] || fieldError(errors, name);
  const messageId = `${id}-message`;
  const content = items.map((child) =>
    child === control
      ? cloneElement(control, {
          id: control.props.id || id,
          'aria-invalid': !!error,
          'aria-describedby':
            [control.props['aria-describedby'], (error || hint) && messageId]
              .filter(Boolean)
              .join(' ') || undefined,
        })
      : child,
  );
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      {label && (
        <label className="field-label" htmlFor={control?.props.id || id}>
          {label}
        </label>
      )}
      {content}
      {(error || hint) && (
        <small id={messageId} className={error ? 'field-error' : undefined} aria-live="polite">
          {error || hint}
        </small>
      )}
    </div>
  );
}
