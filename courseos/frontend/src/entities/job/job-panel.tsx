import { useState } from 'react';
import type { Job } from '../course';
import { useApi, useCommand } from '../course';
import { Badge, ErrorMessage, statuses } from '../../shared/ui/ui';
export function JobPanel({
  job,
  version,
  readonly = false,
  compact = false,
}: {
  job: Job;
  version: number;
  readonly?: boolean;
  compact?: boolean;
}) {
  const command = useCommand();
  const { api } = useApi();
  const [open, setOpen] = useState(false);
  const active = ['running', 'queued'].includes(job.status);
  const elapsed = (
    (Date.parse(job.completed_at || job.updated_at) - Date.parse(job.started_at)) /
    1000
  ).toFixed(1);
  return (
    <div className={`job-panel${compact ? ' job-compact' : ''}`}>
      <div className="job-line">
        {!compact && (
          <Badge
            tone={
              active || job.status === 'succeeded'
                ? 'green'
                : job.status === 'failed'
                  ? 'red'
                  : ['awaiting_approval', 'awaiting_clarification', 'needs_review'].includes(
                        job.status,
                      )
                    ? 'amber'
                    : 'neutral'
            }
          >
            {statuses[job.status]}
          </Badge>
        )}
        <strong>{job.next_action}</strong>
        <button className="link-button" onClick={() => setOpen(!open)} aria-expanded={open}>
          Журнал {open ? '↑' : '↓'}
        </button>
      </div>
      {open && (
        <div className="job-detail">
          {compact && <p>Состояние операции: {statuses[job.status]}</p>}
          <p>
            {api.mode === 'demo' ? 'Демонстрационная операция' : 'Операция сервера'} · время событий{' '}
            {elapsed} с · попытка {job.attempt}
          </p>
          <p>{job.usage.source}. Лимиты кейса 3/20 минут здесь не измерялись.</p>
          <code>job_id: {job.id}</code>
          <ol>
            {job.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {job.error && <p>{job.error}</p>}
          {!readonly && active && (
            <button
              onClick={() =>
                command.mutate({
                  action: 'cancel',
                  expected_version: version,
                  payload: { job_id: job.id },
                })
              }
              disabled={command.isPending}
            >
              Остановить дальнейшие шаги
            </button>
          )}
          {!readonly && ['failed', 'cancelled'].includes(job.status) && (
            <button
              onClick={() =>
                command.mutate({
                  action: 'retry',
                  expected_version: version,
                  payload: { job_id: job.id },
                })
              }
              disabled={command.isPending}
            >
              Повторить незавершённый шаг
            </button>
          )}
          <ErrorMessage error={command.error} />
        </div>
      )}
    </div>
  );
}
