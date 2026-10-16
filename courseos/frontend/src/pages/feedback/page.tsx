import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useApi, useFeedback } from '../../entities/course/api/provider';
import {
  feedbackReasons,
  feedbackSectionTitles,
  feedbackSubjectTitles,
  summarizeFeedback,
  type FeedbackSection,
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

function downloadJson(entries: ResponseFeedback[]) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' }),
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
  const [rating, setRating] = useState<'all' | 'up' | 'down'>('all');
  const [section, setSection] = useState<FeedbackSection | 'all'>('all');
  if (feedback.isPending) return <Loading />;
  if (!feedback.data) return <ErrorMessage error={feedback.error} />;
  const entries = [...feedback.data].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const summary = summarizeFeedback(entries);
  const visible = entries.filter(
    (entry) =>
      (rating === 'all' || entry.rating === rating) &&
      (section === 'all' || entry.section === section),
  );
  return (
    <>
      <header className="page-heading heading-action">
        <div>
          <h1>Отзывы о генерации</h1>
          <p>
            Оценки методистов к сгенерированным страницам и правкам с ИИ. По ним видно, где система
            ошибается чаще всего и что стоит сохранить.
            {api.mode === 'demo' && ' В демо-режиме отзывы хранятся только в этом браузере.'}
          </p>
        </div>
        <div className="heading-buttons">
          <button
            className="secondary"
            disabled={!entries.length}
            onClick={() => downloadJson(entries)}
          >
            <Download size={16} />
            Скачать JSON
          </button>
        </div>
      </header>
      {!entries.length ? (
        <Empty title="Отзывов пока нет">
          Оценить результат можно внизу страниц программы и в окне «Изменить с ИИ».
        </Empty>
      ) : (
        <>
          <dl className="feedback-summary">
            <div>
              <dt>Всего</dt>
              <dd>{summary.total}</dd>
            </div>
            <div>
              <dt>Нравится</dt>
              <dd>{summary.liked}</dd>
            </div>
            <div>
              <dt>Не нравится</dt>
              <dd>{summary.disliked}</dd>
            </div>
            <div>
              <dt>Доля положительных</dt>
              <dd>{Math.round((summary.liked / summary.total) * 100)}%</dd>
            </div>
          </dl>
          <div className="feedback-breakdown">
            <Panel title="По разделам" subtitle="Сверху — разделы с наибольшим числом жалоб">
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
          <Panel title="Все отзывы">
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
            </div>
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
