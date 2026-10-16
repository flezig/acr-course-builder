import type { ReactNode } from 'react';
import { errorMessage } from '../lib/error-message';
import { AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'error' | 'success' | 'warning';
}) {
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      <div>{children}</div>
    </div>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? <Notice tone="error">{errorMessage(error)}</Notice> : null;
}
export function Loading() {
  return (
    <div className="loading">
      <Loader2 className="spin" size={24} /> Загрузка программы…
    </div>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export { Field, Form } from './form';
export function Panel({
  title,
  subtitle,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel>
      <div className="empty">
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </Panel>
  );
}
export const statuses: Record<string, string> = {
  queued: 'В очереди',
  running: 'Создаётся часть комплекта',
  awaiting_clarification: 'Нужны уточнения',
  awaiting_approval: 'Ожидает утверждения',
  needs_review: 'Нужна проверка',
  succeeded: 'Операция завершена',
  failed: 'Ошибка',
  cancelled: 'Остановлено',
  verified: 'Расчёт проверен',
  blocked: 'Требуется решение',
  provided: 'Предоставлен',
  unconfirmed: 'Не подтверждён',
  retrieved: 'Текст получен',
  human_verified: 'Проверен человеком',
  passed: 'Пройдено',
  not_run: 'Не выполнено',
};
