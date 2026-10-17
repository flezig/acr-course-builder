import type { Job } from '../course';
import { useCommand } from '../course';
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
  const active = ['running', 'queued'].includes(job.status);
  const retryable =
    ['failed', 'cancelled'].includes(job.status) || (job.status === 'needs_review' && !!job.error);
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
      </div>
      {(job.error || (!readonly && (active || retryable))) && (
        <div className="job-detail">
          {compact && <p>Состояние операции: {statuses[job.status]}</p>}
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
          {!readonly && retryable && (
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
              Повторить незавершённые шаги
            </button>
          )}
          <ErrorMessage error={command.error} />
        </div>
      )}
    </div>
  );
}
