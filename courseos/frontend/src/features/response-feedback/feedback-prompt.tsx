import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import {
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

/**
 * Оценка ответа системы. Оценка сохраняется сразу по клику: причины и комментарий
 * необязательны и дополняют уже сохранённый отзыв, а не задерживают его.
 */
export function FeedbackPrompt({
  subject,
  section,
  question,
  request = null,
  responseNote = null,
}: {
  subject: FeedbackInput['subject'];
  section: FeedbackSection;
  question: string;
  request?: string | null;
  responseNote?: string | null;
}) {
  const course = useCourse();
  const feedback = useFeedback();
  const record = useRecordFeedback();
  const update = useUpdateFeedback();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [details, setDetails] = useState<{ reasons: FeedbackReason[]; comment: string } | null>(
    null,
  );
  const snapshot = course.data?.snapshot;
  if (!snapshot) return null;

  // Страницу одной версии оценивают один раз: повторный заход показывает прежнюю
  // оценку, а не плодит дубли. Каждое предложение ИИ — отдельный ответ и отдельный отзыв.
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
      // Причины «понравилось» не подходят к оценке «не понравилось» и наоборот.
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
    <form
      className="response-feedback"
      aria-label="Отзыв об ответе системы"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saved || !details) return;
        update.mutate(
          { id: saved.id, patch: { reasons: details.reasons, comment: details.comment.trim() } },
          { onSuccess: () => setDetails(null) },
        );
      }}
    >
      <div className="response-feedback-question">
        <span>{question}</span>
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
            {rating === 'up' ? <ThumbsUp size={16} /> : <ThumbsDown size={16} />}
          </button>
        ))}
      </div>
      {saved && !details && (
        <p className="response-feedback-status">
          Оценка сохранена.{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => setDetails({ reasons: saved.reasons, comment: saved.comment })}
          >
            {saved.reasons.length || saved.comment ? 'Изменить подробности' : 'Добавить причину'}
          </button>{' '}
          · <Link to="/feedback">Все отзывы</Link>
        </p>
      )}
      {saved && details && (
        <>
          <div className="response-feedback-reasons" role="group" aria-label="Причины">
            {(Object.keys(feedbackReasons) as FeedbackReason[])
              .filter((reason) => feedbackReasons[reason].rating === saved.rating)
              .map((reason) => (
                <button
                  key={reason}
                  type="button"
                  aria-pressed={details.reasons.includes(reason)}
                  onClick={() =>
                    setDetails({
                      ...details,
                      reasons: details.reasons.includes(reason)
                        ? details.reasons.filter((item) => item !== reason)
                        : [...details.reasons, reason],
                    })
                  }
                >
                  {feedbackReasons[reason].title}
                </button>
              ))}
          </div>
          <textarea
            rows={2}
            maxLength={2000}
            value={details.comment}
            aria-label="Комментарий к отзыву"
            placeholder={
              saved.rating === 'down'
                ? 'Что именно не так? Например, тема, часы или формулировка'
                : 'Что стоит сохранить в следующих ответах?'
            }
            onChange={(event) => setDetails({ ...details, comment: event.target.value })}
          />
          <div className="actions">
            <button className="primary" type="submit" disabled={pending}>
              {update.isPending ? 'Сохраняем…' : 'Сохранить подробности'}
            </button>
            <button type="button" onClick={() => setDetails(null)}>
              Без подробностей
            </button>
          </div>
        </>
      )}
      <ErrorMessage error={record.error || update.error || feedback.error} />
    </form>
  );
}
