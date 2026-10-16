import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCourse, useRecordFeedback } from '../../entities/course/api/provider';
import {
  feedbackReasons,
  type FeedbackInput,
  type FeedbackRating,
  type FeedbackReason,
  type FeedbackSection,
} from '../../entities/course/model/feedback';
import { ErrorMessage, Notice } from '../../shared/ui/ui';
import './response-feedback.css';

/** Оценка ответа системы: «нравится / не нравится», причины и комментарий. */
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
  const record = useRecordFeedback();
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [comment, setComment] = useState('');
  const snapshot = course.data?.snapshot;
  if (!snapshot) return null;

  if (record.isSuccess)
    return (
      <div className="response-feedback">
        <Notice tone="success">
          Спасибо, отзыв сохранён. <Link to="/feedback">Все отзывы</Link>
        </Notice>
      </div>
    );

  function choose(next: FeedbackRating) {
    setRating(next);
    // Причины «понравилось» не подходят к оценке «не понравилось» и наоборот.
    setReasons([]);
    record.reset();
  }

  return (
    <form
      className="response-feedback"
      aria-label="Отзыв об ответе системы"
      onSubmit={(event) => {
        event.preventDefault();
        if (!rating) return;
        record.mutate({
          course_id: snapshot.course_id,
          course_version: snapshot.course_version,
          course_title: snapshot.skeleton.requirements.title,
          subject,
          section,
          rating,
          reasons,
          comment: comment.trim(),
          request: request?.trim() || null,
          response_note: responseNote,
        });
      }}
    >
      <div className="response-feedback-question">
        <span>{question}</span>
        <button
          type="button"
          className="response-feedback-rating"
          aria-pressed={rating === 'up'}
          aria-label="Нравится"
          title="Нравится"
          onClick={() => choose('up')}
        >
          <ThumbsUp size={16} />
        </button>
        <button
          type="button"
          className="response-feedback-rating"
          aria-pressed={rating === 'down'}
          aria-label="Не нравится"
          title="Не нравится"
          onClick={() => choose('down')}
        >
          <ThumbsDown size={16} />
        </button>
      </div>
      {rating && (
        <>
          <div className="response-feedback-reasons" role="group" aria-label="Причины">
            {(Object.keys(feedbackReasons) as FeedbackReason[])
              .filter((reason) => feedbackReasons[reason].rating === rating)
              .map((reason) => (
                <button
                  key={reason}
                  type="button"
                  aria-pressed={reasons.includes(reason)}
                  onClick={() =>
                    setReasons((current) =>
                      current.includes(reason)
                        ? current.filter((item) => item !== reason)
                        : [...current, reason],
                    )
                  }
                >
                  {feedbackReasons[reason].title}
                </button>
              ))}
          </div>
          <textarea
            rows={2}
            maxLength={2000}
            value={comment}
            aria-label="Комментарий к отзыву"
            placeholder={
              rating === 'down'
                ? 'Что именно не так? Например, тема, часы или формулировка'
                : 'Что стоит сохранить в следующих ответах?'
            }
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="actions">
            <button className="primary" type="submit" disabled={record.isPending}>
              {record.isPending ? 'Сохраняем…' : 'Отправить отзыв'}
            </button>
            <button type="button" onClick={() => setRating(null)}>
              Отмена
            </button>
          </div>
        </>
      )}
      <ErrorMessage error={record.error} />
    </form>
  );
}
