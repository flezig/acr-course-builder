import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  useAiEditOutcomes,
  useApi,
  useFeedback,
  useUpdateFeedback,
} from '../../entities/course/api/provider';
import {
  feedbackReasons,
  feedbackSectionTitles,
  feedbackStatusTitles,
  feedbackSubjectTitles,
  summarizeAiEdits,
  summarizeFeedback,
  type AiEditOutcome,
  type FeedbackSection,
  type FeedbackStatus,
  type ResponseFeedback,
} from '../../entities/course/model/feedback';
import { Badge, Empty, ErrorMessage, Loading, Panel } from '../../shared/ui/ui';
import './feedback.css';

// Области правки с ИИ живут на вкладках страницы программы и на карте.
const sectionPaths: Record<FeedbackSection, string> = {
  plan: 'plan',
  map: 'map',
  audit: 'audit',
  materials: 'materials',
  intent: 'plan#intent',
  curriculum: 'plan#curriculum',
  calendar: 'plan#calendar',
  outcomes: 'map',
};
function entryHref(entry: ResponseFeedback) {
  const [page, hash] = sectionPaths[entry.section].split('#');
  return `/courses/${entry.course_id}/${page}?version=${entry.course_version}${hash ? `#${hash}` : ''}`;
}

const percent = (part: number, total: number) =>
  total ? `${Math.round((part / total) * 100)}%` : '—';

function downloadJson(feedback: ResponseFeedback[], aiEditOutcomes: AiEditOutcome[]) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ feedback, ai_edit_outcomes: aiEditOutcomes }, null, 2)], {
      type: 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `courseos-feedback-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function FeedbackPage() {
  const { api } = useApi();
  const feedback = useFeedback();
  const outcomes = useAiEditOutcomes();
  const update = useUpdateFeedback();
  const [rating, setRating] = useState<'all' | 'up' | 'down'>('all');
  const [section, setSection] = useState<FeedbackSection | 'all'>('all');
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('all');
  if (feedback.isPending || outcomes.isPending) return <Loading />;
  if (!feedback.data || !outcomes.data)
    return <ErrorMessage error={feedback.error || outcomes.error} />;
  const entries = [...feedback.data].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const summary = summarizeFeedback(entries);
  const visible = entries.filter(
    (entry) =>
      (rating === 'all' || entry.rating === rating) &&
      (section === 'all' || entry.section === section) &&
      (status === 'all' || (entry.rating === 'down' && entry.status === status)),
  );
  return (
    <>
      <header className="page-heading heading-action">
        <div>
          <h1>Отзывы о генерации</h1>
          <p>
            Оценки методистов к сгенерированным страницам и правкам с ИИ, а также то, какие правки
            ИИ методисты утвердили или отклонили. По ним видно, где система ошибается чаще всего и
            что стоит сохранить.
            {api.mode === 'demo' && ' В демо-режиме всё хранится только в этом браузере.'}
          </p>
        </div>
        <div className="heading-buttons">
          <button
            className="secondary"
            disabled={!entries.length && !outcomes.data.length}
            onClick={() => downloadJson(entries, outcomes.data)}
          >
            <Download size={16} />
            Скачать JSON
          </button>
        </div>
      </header>
      {!entries.length && !outcomes.data.length ? (
        <Empty title="Отзывов пока нет">
          Оценить результат можно внизу страниц программы и в окне «Изменить с ИИ».
        </Empty>
      ) : (
        <>
          <dl className="feedback-summary">
            <div>
              <dt>Оценок</dt>
              <dd>{summary.total}</dd>
            </div>
            <div>
              <dt>Доля положительных</dt>
              <dd>{percent(summary.liked, summary.total)}</dd>
            </div>
            <div>
              <dt>Жалоб ждут разбора</dt>
              <dd>{summary.awaitingReview}</dd>
            </div>
            <div>
              <dt>Принято правок ИИ</dt>
              <dd>
                {percent(
                  summarizeAiEdits(outcomes.data).accepted,
                  outcomes.data.reduce((sum, outcome) => sum + outcome.changes.length, 0),
                )}
              </dd>
            </div>
          </dl>
          <div className="feedback-breakdown">
            <Panel title="По разделам" subtitle="Сверху — разделы с наибольшим числом жалоб">
              {summary.bySection.length ? (
                <table className="feedback-table">
                  <thead>
                    <tr>
                      <th>Раздел</th>
                      <th>Нравится</th>
                      <th>Не нравится</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.bySection.map((row) => (
                      <tr key={row.section}>
                        <td>{feedbackSectionTitles[row.section]}</td>
                        <td>{row.liked}</td>
                        <td>{row.disliked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">Оценок пока нет.</p>
              )}
            </Panel>
            <Panel title="Частые проблемы" subtitle="Причины из отрицательных отзывов">
              {summary.dislikeReasons.length ? (
                <ul className="feedback-reasons-list">
                  {summary.dislikeReasons.map(({ reason, count }) => (
                    <li key={reason}>
                      <span>{feedbackReasons[reason].title}</span>
                      <strong>{count}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Причины в отрицательных отзывах пока не отмечали.</p>
              )}
            </Panel>
          </div>
          <AiEditPanel outcomes={outcomes.data} />
          <Panel title="Все оценки">
            <div className="feedback-filters">
              <label>
                Оценка{' '}
                <select
                  value={rating}
                  onChange={(event) => setRating(event.target.value as typeof rating)}
                >
                  <option value="all">Все</option>
                  <option value="up">Нравится</option>
                  <option value="down">Не нравится</option>
                </select>
              </label>
              <label>
                Раздел{' '}
                <select
                  value={section}
                  onChange={(event) => setSection(event.target.value as typeof section)}
                >
                  <option value="all">Все</option>
                  {summary.bySection.map(({ section: item }) => (
                    <option key={item} value={item}>
                      {feedbackSectionTitles[item]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Разбор жалоб{' '}
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as typeof status)}
                >
                  <option value="all">Все</option>
                  {(Object.keys(feedbackStatusTitles) as FeedbackStatus[]).map((item) => (
                    <option key={item} value={item}>
                      {feedbackStatusTitles[item]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ErrorMessage error={update.error} />
            {!visible.length && <p className="muted">Под выбранные условия отзывов нет.</p>}
            <ul className="feedback-entries">
              {visible.map((entry) => (
                <li key={entry.id} className={`feedback-entry ${entry.rating}`}>
                  <div className="feedback-entry-heading">
                    {entry.rating === 'up' ? (
                      <ThumbsUp size={16} aria-label="Нравится" />
                    ) : (
                      <ThumbsDown size={16} aria-label="Не нравится" />
                    )}
                    <Link to={entryHref(entry)}>
                      {entry.course_title} · v{entry.course_version}
                    </Link>
                    <span className="muted">
                      {feedbackSubjectTitles[entry.subject]} ·{' '}
                      {feedbackSectionTitles[entry.section]} ·{' '}
                      {new Date(entry.created_at).toLocaleString('ru-RU')}
                    </span>
                    {entry.rating === 'down' && (
                      <select
                        className="feedback-entry-status"
                        aria-label={`Статус разбора: ${entry.course_title}`}
                        value={entry.status}
                        disabled={update.isPending}
                        onChange={(event) =>
                          update.mutate({
                            id: entry.id,
                            patch: { status: event.target.value as FeedbackStatus },
                          })
                        }
                      >
                        {(Object.keys(feedbackStatusTitles) as FeedbackStatus[]).map((item) => (
                          <option key={item} value={item}>
                            {feedbackStatusTitles[item]}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {entry.reasons.length > 0 && (
                    <div className="feedback-entry-reasons">
                      {entry.reasons.map((reason) => (
                        <Badge key={reason} tone={entry.rating === 'up' ? 'green' : 'amber'}>
                          {feedbackReasons[reason].title}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {entry.comment && <p>{entry.comment}</p>}
                  {entry.request && (
                    <p className="muted">
                      Запрос к ИИ: <q>{entry.request}</q>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </>
  );
}

function AiEditPanel({ outcomes }: { outcomes: AiEditOutcome[] }) {
  const summary = summarizeAiEdits(outcomes);
  return (
    <Panel
      title="Правки с ИИ"
      subtitle="Учитываются сами: какие поля методист утвердил, а какие оставил как было"
    >
      {!outcomes.length ? (
        <p className="muted">Решений по предложениям ИИ пока нет.</p>
      ) : (
        <div className="feedback-breakdown nested">
          <div>
            <p>
              Предложений: <strong>{summary.proposals}</strong> · утверждено полей{' '}
              <strong>{summary.accepted}</strong> из{' '}
              <strong>{summary.accepted + summary.rejected}</strong>
            </p>
            <table className="feedback-table">
              <thead>
                <tr>
                  <th>Область</th>
                  <th>Утверждено</th>
                  <th>Отклонено</th>
                </tr>
              </thead>
              <tbody>
                {summary.byScope.map((row) => (
                  <tr key={row.scope}>
                    <td>{feedbackSectionTitles[row.scope]}</td>
                    <td>{row.accepted}</td>
                    <td>{row.rejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3>Чаще всего отклоняют</h3>
            {summary.mostRejected.length ? (
              <ul className="feedback-reasons-list">
                {summary.mostRejected.map(({ field, rejected, total }) => (
                  <li key={field}>
                    <span>{field}</span>
                    <strong>
                      {rejected} из {total}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Все предложенные поля утверждены.</p>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
