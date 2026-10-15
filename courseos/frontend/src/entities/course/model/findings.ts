import Decimal from 'decimal.js';
import type { Audit, Requirements, Skeleton } from './schema';
import { isOnHourStep, isInternship, selfStudyAllowed } from './hours-plan';
import { assessmentLabels } from './presets';
import { bankReportAssessment } from './bank-scenario';
import { formatHours } from '../../../shared/lib/decimal';

type Issue = Audit['issues'][number];

export function outcomeNumber(skeleton: Skeleton, outcomeId: string) {
  return skeleton.outcomes.findIndex((outcome) => outcome.id === outcomeId) + 1;
}

function topicPlace(skeleton: Skeleton, topicId: string) {
  if (topicId === 'topic-final') return 'итоговая аттестация';
  const topic = skeleton.topics.find((item) => item.id === topicId);
  return topic ? `модуль ${topic.module_id.replace('module-', '')}` : 'место не найдено';
}

export function outcomeAssessments(skeleton: Skeleton, outcomeId: string) {
  return skeleton.assessments.filter((assessment) => assessment.outcome_ids.includes(outcomeId));
}

export function outcomeAssessmentTypeCount(skeleton: Skeleton, outcomeId: string) {
  return new Set(outcomeAssessments(skeleton, outcomeId).map((assessment) => assessment.type)).size;
}

// Тема, в которой результат осваивается до итоговой аттестации: туда агент добавляет
// недостающее средство текущего контроля.
export function outcomeStudyTopic(skeleton: Skeleton, outcomeId: string) {
  return skeleton.topics.find(
    (topic) =>
      topic.id !== 'topic-final' &&
      topic.outcome_ids.includes(outcomeId) &&
      !outcomeAssessments(skeleton, outcomeId).some((a) => a.topic_id === topic.id),
  );
}

export function proposedAssessment(skeleton: Skeleton, outcomeId: string) {
  const topic = outcomeStudyTopic(skeleton, outcomeId);
  if (!topic) return null;
  const used = new Set(outcomeAssessments(skeleton, outcomeId).map((a) => a.type));
  const bankTemplate =
    topic.id === `topic-${bankReportAssessment.topic}` &&
    skeleton.requirements.audience.toLowerCase().includes('банк')
      ? bankReportAssessment
      : null;
  const type = bankTemplate?.type || (used.has('practical') ? 'test' : 'practical');
  return {
    id: `assessment-${outcomeNumber(skeleton, outcomeId)}-added`,
    topic_id: topic.id,
    outcome_ids: [outcomeId],
    type,
    action: bankTemplate?.action || `Выполняет задание темы «${topic.title}» на новом примере`,
    criterion:
      bankTemplate?.criterion ||
      'Результат совпадает с эталоном; решение объяснено; предметный порог уточняет методист',
  } satisfies Skeleton['assessments'][number];
}

export function coverageIssue(skeleton: Skeleton, outcome: Skeleton['outcomes'][number]): Issue {
  const number = outcomeNumber(skeleton, outcome.id);
  const assessments = outcomeAssessments(skeleton, outcome.id);
  const types = new Set(assessments.map((a) => a.type));
  const proposal = proposedAssessment(skeleton, outcome.id);
  const found = assessments.length
    ? assessments
        .map((a) => `${assessmentLabels[a.type]}, ${topicPlace(skeleton, a.topic_id)}`)
        .join('; ')
    : 'средств нет';
  return {
    id: `audit-${outcome.id}`,
    severity: 'error',
    check_type: 'rule',
    element_id: outcome.id,
    message: `Результат ${number} проверяется ${types.size === 1 ? 'одним оценочным средством' : 'без оценочных средств'} из двух нужных`,
    evidence: `«${outcome.title || outcome.description}»: ${found}.`,
    expected: 'Тема, активность и два разных оценочных средства',
    actual: `Разных средств: ${types.size}`,
    suggested_fix: proposal
      ? `Добавить ${assessmentLabels[proposal.type].toLowerCase()} в ${topicPlace(skeleton, proposal.topic_id)}: ${proposal.action.toLowerCase()}. Критерий: ${proposal.criterion}.`
      : 'Добавьте тему, в которой результат осваивается, и средство текущего контроля в редакторе программы.',
    fix: proposal ? 'add_assessment' : undefined,
    blocking: true,
  };
}

// Календарь, который агент может предложить сам: будни в пределах заявленного срока
// и минимальная дневная нагрузка с шагом 0,5 ч, при которой объём помещается.
export function proposedCalendar(requirements: Requirements): Requirements['calendar'] | null {
  const calendar = requirements.calendar;
  if (!requirements.total_hours || !calendar.start || calendar.calendar_days < 1) return null;
  const start = new Date(`${calendar.start}T00:00:00Z`);
  let days = 0;
  for (let i = 0; i < calendar.calendar_days; i++) {
    const day = new Date(start.getTime() + i * 86400000).getUTCDay();
    if (day !== 0 && day !== 6) days++;
  }
  if (!days) return null;
  const limit = new Decimal(requirements.total_hours).div(days).div('0.5').ceil().times('0.5');
  const weeks = Math.ceil(calendar.calendar_days / 7);
  return {
    ...calendar,
    weekdays_only: true,
    daily_limit: limit.toString(),
    confirmed: true,
    same_units: true,
    description: `${weeks} нед. по будням: ${days} учебных дней, до ${formatHours(limit.toString())} ч в день. Подтверждено методистом.`,
  };
}

export function calendarProposalText(requirements: Requirements) {
  const proposal = proposedCalendar(requirements);
  if (!proposal) return null;
  const weeks = Math.ceil(proposal.calendar_days / 7);
  const days = proposal.description.match(/(\d+) учебных дней/)?.[1];
  const capacity = new Decimal(proposal.daily_limit).times(days || 0);
  const weekly = new Decimal(requirements.total_hours).div(weeks).toDecimalPlaces(1);
  return `${weeks} нед. по будням, до ${formatHours(proposal.daily_limit)} ч в день: ${days} дней × ${formatHours(proposal.daily_limit)} ч = ${formatHours(capacity.toString())} ч ≥ ${formatHours(requirements.total_hours)} ч; в среднем ${formatHours(weekly.toString())} ч в неделю.`;
}

const bankContext = ['клиент', 'кредит', 'просроч', 'отток', 'портфел', 'вклад', 'отделени'];

// Находки агента: то, что формальная проверка пропустит, а методист заметит при вычитке.
export function agentFindings(skeleton: Skeleton): Issue[] {
  const requirements = skeleton.requirements;
  const issues: Issue[] = [];
  const studyTopics = skeleton.topics.filter((topic) => topic.id !== 'topic-final');

  const offStep = skeleton.topics.flatMap((topic) =>
    Object.values(topic.hours)
      .filter((value) => !isOnHourStep(value))
      .map((value) => `${topic.title}: ${formatHours(value)} ч`),
  );
  if (offStep.length)
    issues.push({
      id: 'hour-step',
      severity: 'error',
      check_type: 'rule',
      element_id: skeleton.topics[0].id,
      message: 'Часы записаны с шагом меньше 0,5 ч',
      evidence: offStep.slice(0, 3).join('; '),
      expected: 'Все часы кратны 0,5, как в образцах АЦР',
      actual: `${offStep.length} значений с дробным остатком`,
      suggested_fix: 'Округлите часы темы до 0,5 ч и сохраните сумму модуля.',
      blocking: true,
    });

  if (requirements.template_id === 'acr_professional') {
    const confirmed = skeleton.outcomes.some((outcome) => outcome.professional_standard_code);
    if (!confirmed)
      issues.push({
        id: 'professional-standard',
        severity: 'warning',
        check_type: 'llm',
        element_id: 'legal',
        message: 'Профстандарт не подтверждён: код не указан',
        evidence:
          'В запросе и приложениях нет текста профстандарта в этой области. Код не заполнен, чтобы не выдумывать его.',
        expected: 'Действующий профстандарт с проверенным кодом и трудовыми функциями',
        actual: 'Требует подтверждения',
        suggested_fix:
          'Приложите текст профстандарта из реестра Минтруда — агент свяжет результаты с трудовыми функциями. До этого поле кода остаётся пустым.',
        dismissible: true,
        blocking: true,
      });
  }

  const unconfirmedTools = (skeleton.tools || []).filter((tool) => tool.status !== 'confirmed');
  if (unconfirmedTools.length)
    issues.push({
      id: 'tool-versions',
      severity: 'warning',
      check_type: 'llm',
      element_id: 'tools',
      message: 'Версии инструментов не подтверждены источником',
      evidence: `${unconfirmedTools.length} из ${skeleton.tools!.length} без версии и даты проверки: ${unconfirmedTools.map((tool) => tool.name).join(', ')}.`,
      expected: 'Версия, источник и дата проверки на 2026 год',
      actual: 'Требует подтверждения',
      suggested_fix:
        'Проверьте актуальные версии на официальных сайтах перед стартом и укажите дату проверки. Агент не подставляет версии без источника.',
      dismissible: true,
      blocking: false,
    });

  if (selfStudyAllowed(requirements) && !isInternship(requirements)) {
    const shares = studyTopics
      .filter((topic) => !topic.title.toLowerCase().includes('проект'))
      .map((topic) => ({
        topic,
        share: new Decimal(topic.hours.self_study).div(topic.planned_total || 1),
      }));
    const sorted = [...shares].sort((a, b) => a.share.comparedTo(b.share));
    const low = sorted[0];
    const high = sorted.at(-1);
    if (low && high && high.share.minus(low.share).gt('0.25'))
      issues.push({
        id: 'self-study-skew',
        severity: 'warning',
        check_type: 'llm',
        element_id: high.topic.id,
        message: 'Самостоятельная работа распределена неравномерно',
        evidence: `«${high.topic.title}»: ${formatHours(high.topic.hours.self_study)} из ${formatHours(high.topic.planned_total)} ч; «${low.topic.title}»: ${formatHours(low.topic.hours.self_study)} из ${formatHours(low.topic.planned_total)} ч.`,
        expected: 'Разница долей СРС объяснена типом модуля',
        actual: 'Причина перекоса не записана',
        suggested_fix: 'Выровняйте долю СРС или объясните перекос в обосновании часов модуля.',
        dismissible: true,
        blocking: false,
      });
    const remote = skeleton.topics.reduce(
      (sum, topic) => sum.plus(topic.hours.self_study),
      new Decimal(0),
    );
    if (requirements.delivery.toLowerCase().includes('заоч') && remote.eq(0))
      issues.push({
        id: 'blended-split',
        severity: 'warning',
        check_type: 'llm',
        element_id: 'curriculum',
        message: 'У очно-заочной формы не выделены дистанционные часы',
        evidence: 'Во всех темах СРС = 0, поэтому очные и дистанционные часы не различаются.',
        expected: 'Явное разделение очных и дистанционных часов',
        actual: 'Только очные часы',
        suggested_fix: 'Перенесите самостоятельную часть тем в СРС с дистанционным форматом.',
        dismissible: true,
        blocking: false,
      });
  }

  if (requirements.audience.toLowerCase().includes('банк')) {
    const generic = studyTopics.filter(
      (topic) =>
        !topic.title.toLowerCase().includes('проект') &&
        !bankContext.some((word) => topic.content.toLowerCase().includes(word)),
    );
    if (generic.length)
      issues.push({
        id: 'bank-context',
        severity: 'warning',
        check_type: 'llm',
        element_id: generic[0].id,
        message: 'Семинары без банковского контекста',
        evidence: `Нет банковской ситуации в темах: ${generic.map((topic) => `«${topic.title}»`).join(', ')}.`,
        expected: 'Семинары на ситуациях отделения: отток, просрочка, кредитный портфель',
        actual: 'Учебные задачи без контекста',
        suggested_fix: 'Перепишите задания семинаров на данных отделения.',
        dismissible: true,
        blocking: false,
      });
  }

  for (const reference of requirements.references) {
    const mismatch = samplePlanMismatch(reference.text);
    if (mismatch)
      issues.push({
        id: `sample-total-${reference.id}`,
        severity: 'info',
        check_type: 'llm',
        element_id: reference.id,
        message: 'Итоговая строка образца не сходится. Ошибка не перенесена',
        evidence: `${reference.name}: ${mismatch}.`,
        expected: 'Итог образца равен сумме строк',
        actual: 'Расхождение в образце',
        suggested_fix:
          'Сообщите составителю образца о расхождении. В этой программе итог считается по строкам учебного плана.',
        dismissible: true,
        blocking: false,
      });
  }
  return issues;
}

// Сверяет строку раздела и итоговую строку учебного плана образца, записанные как
// «… ЛК 0, ПР 0, ЛБ 0, СРС 246». Других форматов в демо нет.
export function samplePlanMismatch(text: string) {
  const row = (label: string) => {
    const match = text.match(
      new RegExp(`${label}[^.;]*?ЛК (\\d+), ПР (\\d+), ЛБ (\\d+), СРС (\\d+)`, 'i'),
    );
    return match ? match.slice(1).map(Number) : null;
  };
  const section = row('раздел');
  const total = row('итого');
  if (!section || !total || section.every((value, index) => value === total[index])) return null;
  const describe = ([lk, pr, lb, srs]: number[]) =>
    [lk && `${lk} ЛК`, pr && `${pr} ПР`, lb && `${lb} ЛБ`, srs && `${srs} СРС`]
      .filter(Boolean)
      .join(' + ') || '0';
  return `модуль ${describe(section)}, итог ${describe(total)}`;
}
