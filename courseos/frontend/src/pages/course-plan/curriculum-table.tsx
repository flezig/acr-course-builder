import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Decimal from 'decimal.js';
import { ChevronDown } from 'lucide-react';
import type { Skeleton, Topic } from '../../entities/course/model/schema';
import { assessmentLabels } from '../../entities/course/model/presets';
import { hourTotals } from '../../entities/course/model/rules';
import {
  contactAndRemoteHours,
  isInternship,
  selfStudyAllowed,
} from '../../entities/course/model/hours-plan';
import { decimalEqual, formatHours, sumHours } from '../../shared/lib/decimal';

type WorkKind = 'lecture' | 'practice' | 'lab' | 'self_study';
const workKinds: WorkKind[] = ['lecture', 'practice', 'lab', 'self_study'];
// Подписи колонок повторяют учебные планы образцов АЦР для каждого шаблона.
const professionalLabels: Record<WorkKind, string> = {
  lecture: 'ЛК',
  practice: 'ПР',
  lab: 'ЛБ',
  self_study: 'СРС',
};
const generalLabels: Record<WorkKind, string> = {
  lecture: 'Лекции / теория',
  practice: 'Практические занятия',
  lab: 'Лабораторные',
  self_study: 'Самостоятельная работа',
};
const zeroCaptions: Record<WorkKind, string> = {
  lecture: 'лекций',
  practice: 'практики',
  lab: 'лабораторных',
  self_study: 'самостоятельной работы',
};
const hours = (value: Decimal.Value) => formatHours(new Decimal(value).toString());
// Для очно-заочной формы чек-лист требует явно показать очные и дистанционные часы.
// В стажировке СРС идёт на месте под наставником, поэтому там это просто СРС.
function workLabels(skeleton: Skeleton) {
  const blended = selfStudyAllowed(skeleton.requirements) && !isInternship(skeleton.requirements);
  return blended
    ? { contact: 'Очно', remote: 'Дистанционно (СРС)' }
    : { contact: 'Контактная работа', remote: 'СРС' };
}

export function VolumeSummary({ skeleton }: { skeleton: Skeleton }) {
  const { contact, selfStudy, assessment } = contactAndRemoteHours(skeleton);
  const calendar = skeleton.requirements.calendar;
  const weeks = Math.ceil(calendar.calendar_days / 7);
  const label = workLabels(skeleton);
  return (
    <dl className="volume-summary" aria-label="Объём программы">
      <div>
        <dt>Всего</dt>
        <dd>{hours(skeleton.requirements.total_hours)} ч</dd>
      </div>
      <div>
        <dt>{label.contact}</dt>
        <dd>{hours(contact)} ч</dd>
      </div>
      <div>
        <dt>{label.remote}</dt>
        <dd>{hours(selfStudy)} ч</dd>
      </div>
      <div>
        <dt>Итоговая аттестация</dt>
        <dd>{hours(assessment)} ч</dd>
      </div>
      <div>
        <dt>Срок и режим</dt>
        <dd>
          {weeks ? `${weeks} нед.` : 'не задан'}
          {calendar.daily_limit ? `, до ${hours(calendar.daily_limit)} ч в день` : ''}
        </dd>
      </div>
    </dl>
  );
}

export function CurriculumTable({ skeleton, focused }: { skeleton: Skeleton; focused?: string }) {
  const general = skeleton.requirements.template_id === 'acr_general';
  const labels = general ? generalLabels : professionalLabels;
  const totals = hourTotals(skeleton);
  const [showAll, setShowAll] = useState(false);
  // В рабочем интерфейсе нулевые во всех строках колонки сворачиваются;
  // в выгрузке и официальной таблице набор колонок остаётся по шаблону АЦР.
  const zero = workKinds.filter((kind) => decimalEqual(totals[kind], '0'));
  const visible = showAll ? workKinds : workKinds.filter((kind) => !zero.includes(kind));
  const study = skeleton.topics.filter((topic) => topic.id !== 'topic-final');
  const final = skeleton.topics.find((topic) => topic.id === 'topic-final');
  const modules = [...new Set(study.map((topic) => topic.module_id))];
  const studyTotal = sumHours(workKinds.map((kind) => totals[kind]));
  const contact = (topics: Topic[]) =>
    sumHours(topics.flatMap((t) => [t.hours.lecture, t.hours.practice, t.hours.lab]));
  return (
    <>
      {zero.length > 0 && (
        <p className="zero-columns">
          {showAll
            ? 'Показаны все колонки шаблона АЦР.'
            : `${capitalize(zero.map((kind) => zeroCaptions[kind]).join(', '))} нет — колонки свёрнуты.`}{' '}
          <button className="link-button" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Свернуть нулевые' : 'Показать все колонки'}
          </button>
        </p>
      )}
      <div
        className="table-scroll plan-table acr-plan"
        tabIndex={0}
        role="region"
        aria-label="Учебный план"
      >
        <table>
          <colgroup>
            <col className="curriculum-topic-column" />
            <col />
            {general && <col />}
            {visible.map((kind) => (
              <col key={kind} />
            ))}
            <col className="curriculum-control-column" />
          </colgroup>
          <thead>
            <tr>
              <th>Наименование разделов и тем</th>
              <th>{general ? 'Общая трудоёмкость' : 'Трудоёмкость, всего'}</th>
              {general && <th>Всего аудиторных</th>}
              {visible.map((kind) => (
                <th key={kind}>{labels[kind]}</th>
              ))}
              <th>{general ? 'Форма контроля' : 'Форма аттестации'}</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((moduleId) => {
              const topics = study.filter((topic) => topic.module_id === moduleId);
              return (
                <ModuleRows
                  key={moduleId}
                  skeleton={skeleton}
                  topics={topics}
                  visible={visible}
                  general={general}
                  focused={focused}
                  contact={contact}
                />
              );
            })}
            {final && (
              <tr
                id={final.id}
                className={`final-row ${focused === final.id ? 'field-highlight' : ''}`}
              >
                <th scope="row">
                  <TopicTitle skeleton={skeleton} topic={final} label="Итоговая аттестация" />
                </th>
                <td>{hours(final.planned_total)}</td>
                {general && <td>—</td>}
                {visible.map((kind) => (
                  <td key={kind}>—</td>
                ))}
                <td className="control-cell">
                  <TopicAssessment skeleton={skeleton} topic={final} />
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Итого</th>
              <td>{hours(sumHours([studyTotal, totals.assessment]))}</td>
              {general && <td>{hours(contact(study))}</td>}
              {visible.map((kind) => (
                <td key={kind}>{hours(totals[kind])}</td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function ModuleRows({
  skeleton,
  topics,
  visible,
  general,
  focused,
  contact,
}: {
  skeleton: Skeleton;
  topics: Topic[];
  visible: WorkKind[];
  general: boolean;
  focused?: string;
  contact: (topics: Topic[]) => string;
}) {
  const moduleNumber = topics[0].module_id.replace('module-', '');
  const moduleTitle = skeleton.requirements.model_design?.module_titles[Number(moduleNumber) - 1];
  const moduleLabel = moduleTitle
    ? `Модуль ${moduleNumber}. ${moduleTitle}`
    : `Модуль ${moduleNumber}`;
  const row = (items: Topic[]) => (
    <>
      <td>{hours(sumHours(items.map((t) => t.planned_total)))}</td>
      {general && <td>{hours(contact(items))}</td>}
      {visible.map((kind) => (
        <td
          key={kind}
          className={
            decimalEqual(sumHours(items.map((t) => t.hours[kind])), '0') ? 'zero-hours' : undefined
          }
        >
          {hours(sumHours(items.map((t) => t.hours[kind])))}
        </td>
      ))}
    </>
  );
  if (topics.length === 1)
    return (
      <tr id={topics[0].id} className={focused === topics[0].id ? 'field-highlight' : undefined}>
        <th scope="row">
          <TopicTitle skeleton={skeleton} topic={topics[0]} label={moduleLabel} />
        </th>
        {row(topics)}
        <td className="control-cell">
          <TopicAssessment skeleton={skeleton} topic={topics[0]} />
        </td>
      </tr>
    );
  return (
    <>
      <tr className="module-row">
        <th scope="row">{moduleLabel}</th>
        {row(topics)}
        <td />
      </tr>
      {topics.map((topic, index) => (
        <tr
          key={topic.id}
          id={topic.id}
          className={focused === topic.id ? 'field-highlight' : undefined}
        >
          <th scope="row">
            <TopicTitle
              skeleton={skeleton}
              topic={topic}
              label={`Тема ${moduleNumber}.${index + 1}`}
            />
          </th>
          {row([topic])}
          <td className="control-cell">
            <TopicAssessment skeleton={skeleton} topic={topic} />
          </td>
        </tr>
      ))}
    </>
  );
}

function TopicAssessment({ skeleton, topic }: { skeleton: Skeleton; topic: Topic }) {
  const location = useLocation();
  const assessments = skeleton.assessments.filter((assessment) => assessment.topic_id === topic.id);
  // Несколько критериев одной итоговой работы не превращаем в несколько одинаковых работ.
  const forms = new Set(
    [
      ...topic.control.split('+').map((form) => capitalize(form.split(/[:,]/)[0].trim())),
      ...(topic.id === 'topic-final' && topic.control.trim()
        ? []
        : assessments.map((assessment) => assessmentLabels[assessment.type])),
    ].filter((form) => form && form !== '—'),
  );
  return (
    <div className="topic-assessment">
      {forms.size > 0 ? (
        <ul>
          {[...forms].map((form) => {
            const matching = assessments.filter(
              (assessment) =>
                assessmentLabels[assessment.type].toLowerCase() === form.toLowerCase(),
            );
            const targets = (matching.length ? matching : assessments).flatMap((assessment) => {
              const outcome = skeleton.outcomes.find((outcome) =>
                assessment.outcome_ids.includes(outcome.id),
              );
              return outcome ? [{ assessment, outcome }] : [];
            });
            const label = topic.id === 'topic-final' ? form : `${form} по теме «${topic.title}»`;
            return (
              <li key={form}>
                {targets.length > 1 && `${label}: `}
                {targets.length
                  ? targets.map(({ assessment, outcome }, index) => (
                      <span key={assessment.id}>
                        {index > 0 && ' · '}
                        <Link
                          to={{
                            search: location.search,
                            hash: `#coverage-${outcome.id}-${assessment.id}`,
                          }}
                          title={assessment.action}
                        >
                          {targets.length > 1 ? `задание ${index + 1}` : label}
                        </Link>
                      </span>
                    ))
                  : label}
              </li>
            );
          })}
        </ul>
      ) : (
        <span>—</span>
      )}
    </div>
  );
}

function TopicTitle({
  skeleton,
  topic,
  label,
}: {
  skeleton: Skeleton;
  topic: Topic;
  label: string;
}) {
  const prerequisites = topic.prerequisite_ids
    .map((id) => skeleton.topics.find((item) => item.id === id)?.title)
    .filter(Boolean);
  return (
    <details className="topic-details">
      <summary>
        <ChevronDown size={16} aria-hidden="true" />
        <span>
          <small>{label}</small>
          <span>{topic.title === label ? '' : topic.title}</span>
        </span>
      </summary>
      <div className="topic-content">
        {topic.content.split('\n').map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p>Опирается на: {prerequisites.join(', ') || 'входной уровень слушателей'}</p>
        <p>{topic.delivery}</p>
      </div>
    </details>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
