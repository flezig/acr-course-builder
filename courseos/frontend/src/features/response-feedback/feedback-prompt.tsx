import { useEffect, useId, useRef, useState } from 'react';
import { useMutationState } from '@tanstack/react-query';
import { Check, Plus, ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  useApi,
  useCourse,
  useFeedback,
  useRecordFeedback,
  useUpdateFeedback,
} from '../../entities/course/api/provider';
import {
  feedbackReasons,
  type FeedbackInput,
  type FeedbackRating,
  type FeedbackReason,
  type FeedbackSection,
} from '../../entities/course/model/feedback';
import { ErrorMessage } from '../../shared/ui/ui';
import './response-feedback.css';

// Оценка сохраняется сразу; причины и комментарий дополняют её в отдельном окне.
export function FeedbackPrompt({
  subject,
  section,
  question,
  request = null,
  responseNote = null,
  actionLabel,
}: {
  subject: FeedbackInput['subject'];
  section: FeedbackSection;
  question: string;
  request?: string | null;
  responseNote?: string | null;
  actionLabel?: string;
}) {
  const { api } = useApi();
  const course = useCourse();
  const feedback = useFeedback();
  const record = useRecordFeedback();
  const update = useUpdateFeedback();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [details, setDetails] = useState<{ reasons: FeedbackReason[]; comment: string } | null>(
    null,
  );
  const snapshot = course.data?.snapshot;
  const commands = useMutationState({
    filters: { mutationKey: ['course-command', api.mode, snapshot?.course_id] },
    select: (mutation) => mutation.state.status,
  });
  const ready =
    !!snapshot &&
    (subject !== 'generation' ||
      (!course.isError &&
        ['awaiting_approval', 'needs_review', 'succeeded'].includes(course.data!.job.status) &&
        !['pending', 'error'].includes(commands.at(-1) ?? '')));
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (details && ready && !dialog.open) dialog.showModal();
    if ((!details || !ready) && dialog.open) dialog.close();
  }, [details, ready]);
  if (!snapshot || !ready) return null;

  // Раздел одной версии оценивают один раз; каждое предложение ИИ оценивают отдельно.
  const saved =
    feedback.data?.find((entry) => entry.id === createdId) ??
    (subject === 'generation'
      ? feedback.data
          ?.filter(
            (entry) =>
              entry.subject === 'generation' &&
              entry.course_id === snapshot.course_id &&
              entry.course_version === snapshot.course_version &&
              entry.section === section,
          )
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      : undefined);
  const pending = record.isPending || update.isPending;

  async function rate(rating: FeedbackRating) {
    if (saved?.rating === rating) {
      setDetails({ reasons: saved.reasons, comment: saved.comment });
      return;
    }
    if (saved)
      // При смене оценки прежние причины больше не подходят.
      await update.mutateAsync({ id: saved.id, patch: { rating, reasons: [] } });
    else {
      const entry = await record.mutateAsync({
        course_id: snapshot!.course_id,
        course_version: snapshot!.course_version,
        course_title: snapshot!.skeleton.requirements.title,
        subject,
        section,
        rating,
        reasons: [],
        comment: '',
        request: request?.trim() || null,
        response_note: responseNote,
      });
      setCreatedId(entry.id);
    }
    setDetails({ reasons: [], comment: saved?.comment ?? '' });
  }

  return (
    <div className="response-feedback" role="group" aria-label={actionLabel || question}>
      <div className="response-feedback-ratings">
        {(['up', 'down'] as const).map((rating) => (
          <button
            key={rating}
            type="button"
            className="response-feedback-rating"
            aria-pressed={saved?.rating === rating}
            aria-label={rating === 'up' ? 'Нравится' : 'Не нравится'}
            title={rating === 'up' ? 'Нравится' : 'Не нравится'}
            disabled={pending}
            // Ошибку показывает ErrorMessage из состояния мутации ниже.
            onClick={() => void rate(rating).catch(() => undefined)}
          >
            {rating === 'up' ? <ThumbsUp size={18} /> : <ThumbsDown size={18} />}
          </button>
        ))}
      </div>
      <ErrorMessage error={record.error || feedback.error || (!details && update.error)} />
      <dialog
        ref={dialogRef}
        className="response-feedback-dialog"
        aria-labelledby={titleId}
        onClose={() => setDetails(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setDetails(null);
        }}
      >
        {details && (
          <form
            className="response-feedback-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!saved) return;
              update.mutate(
                {
                  id: saved.id,
                  patch: { reasons: details.reasons, comment: details.comment.trim() },
                },
                { onSuccess: () => setDetails(null) },
              );
            }}
          >
            <h2 id={titleId}>Поделиться отзывом</h2>
            <p className="response-feedback-context">{question}</p>
            <div className="response-feedback-reasons" role="group" aria-label="Причины">
              {(Object.keys(feedbackReasons) as FeedbackReason[])
                .filter((reason) => feedbackReasons[reason].rating === saved?.rating)
                .map((reason) => {
                  const selected = details.reasons.includes(reason);
                  return (
                    <button
                      key={reason}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setDetails({
                          ...details,
                          reasons: selected
                            ? details.reasons.filter((item) => item !== reason)
                            : [...details.reasons, reason],
                        })
                      }
                    >
                      {selected ? <Check size={16} /> : <Plus size={16} />}
                      {feedbackReasons[reason].title}
                    </button>
                  );
                })}
            </div>
            <textarea
              rows={5}
              maxLength={2000}
              value={details.comment}
              aria-label="Комментарий к отзыву"
              placeholder="Поделитесь подробностями (необязательно)"
              onChange={(event) => setDetails({ ...details, comment: event.target.value })}
            />
            <ErrorMessage error={update.error} />
            <button
              className="primary response-feedback-submit"
              type="submit"
              disabled={pending || !saved}
            >
              {update.isPending ? 'Отправляем…' : 'Отправить'}
            </button>
            <button
              type="button"
              className="response-feedback-skip"
              onClick={() => setDetails(null)}
            >
              Без подробностей
            </button>
          </form>
        )}
      </dialog>
    </div>
  );
}
