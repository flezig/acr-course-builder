import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { useCommand } from '../../entities/course/api/provider';
import { programVerdict } from '../../entities/course/model/rules';
import type { Snapshot } from '../../entities/course/model/schema';
import { ErrorMessage } from '../../shared/ui/ui';

const blockingQuestions = (count: number) => {
  const form = new Intl.PluralRules('ru').select(count);
  return `${count} ${form === 'one' ? 'блокирующий вопрос' : form === 'few' ? 'блокирующих вопроса' : 'блокирующих вопросов'}`;
};

// Утверждение живёт в шапке, как кнопка слияния на GitHub: она видна с любой вкладки,
// а рядом написано, что мешает утвердить. Второй шаг подтверждения защищает
// от случайного клика — утверждение запускает создание материалов.
export function ApprovalAction({
  snapshot,
  isLatest,
  active,
  editing,
}: {
  snapshot: Snapshot;
  isLatest: boolean;
  active: boolean;
  editing: boolean;
}) {
  const { search } = useLocation();
  const command = useCommand();
  const [confirming, setConfirming] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const verdict = programVerdict(snapshot);
  useEffect(() => setConfirming(false), [snapshot.course_version]);
  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);

  if (snapshot.approval_applicable) {
    const last = snapshot.approvals.at(-1);
    return (
      <div className="approval-action approved">
        <span className="approval-status" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          Программа утверждена
        </span>
        {last && (
          <small>
            Версия {last.skeleton_version} · {new Date(last.approved_at).toLocaleString('ru-RU')}
          </small>
        )}
      </div>
    );
  }

  const reason = !isLatest
    ? 'Утверждение доступно в актуальной версии'
    : active
      ? 'Дождитесь завершения текущей операции'
      : editing
        ? 'Сначала сохраните или закройте редактор'
        : '';
  const cancel = () => {
    setConfirming(false);
    requestAnimationFrame(() => approveButton.current?.focus());
  };
  return (
    <div className="approval-action">
      <button
        ref={approveButton}
        className="primary"
        aria-expanded={confirming}
        aria-controls="approval-confirm"
        disabled={verdict.open > 0 || !!reason || command.isPending}
        onClick={() => setConfirming(!confirming)}
      >
        Утвердить
      </button>
      {verdict.open > 0 && verdict.first ? (
        <Link className="approval-hint" to={{ search, hash: `#issue-${verdict.first.id}` }}>
          Сначала закройте {blockingQuestions(verdict.open)}
        </Link>
      ) : (
        reason && <small className="approval-hint">{reason}</small>
      )}
      {confirming && !reason && verdict.open === 0 && (
        <div
          id="approval-confirm"
          className="approval-confirm"
          role="group"
          aria-label="Подтверждение утверждения"
          onKeyDown={(event) => {
            if (event.key === 'Escape') cancel();
          }}
        >
          <p>
            Цель, результаты, часы, оценивание и основания проверены. Утвердить версию{' '}
            {snapshot.skeleton_version}? После этого начнётся создание материалов.
          </p>
          <div className="approval-confirm-actions">
            <button
              ref={confirmButton}
              className="primary"
              disabled={command.isPending}
              onClick={() =>
                command.mutate(
                  {
                    action: 'approve',
                    expected_version: snapshot.course_version,
                    payload: {
                      skeleton_version: snapshot.skeleton_version,
                      skeleton_hash: snapshot.skeleton_hash,
                    },
                  },
                  { onSuccess: () => setConfirming(false) },
                )
              }
            >
              {command.isPending ? 'Сохраняем утверждение…' : 'Подтвердить утверждение'}
            </button>
            <button className="secondary" disabled={command.isPending} onClick={cancel}>
              Отмена
            </button>
          </div>
          <ErrorMessage error={command.error} />
        </div>
      )}
    </div>
  );
}
