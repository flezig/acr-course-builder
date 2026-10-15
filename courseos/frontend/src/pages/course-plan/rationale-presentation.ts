import type { Rationale, Skeleton } from '../../entities/course/model/schema';
import { rationaleIsSupported, type SkeletonElement } from '../../entities/course/model/rationale';
import { hourLabels, sumHours } from '../../shared/lib/decimal';
import { assessmentLabels } from '../../entities/course/model/presets';

export const rationaleGroups = [
  { id: 'intent', title: 'Цель и участники' },
  { id: 'outcomes', title: 'Результаты обучения' },
  { id: 'topics', title: 'Темы и порядок' },
  { id: 'assessment', title: 'Проверка знаний' },
  { id: 'time', title: 'Часы и расписание' },
] as const;
export type RationaleGroup = (typeof rationaleGroups)[number]['id'];
// Практика показывается внутри модуля своей темы, но пояснения к ней остаются свои.
type RationaleKind = RationaleGroup | 'practice';

const hours = (value: string) => `${value.replace('.', ',')} уч. ч.`;

export function rationaleGroup(s: Skeleton, id: string): RationaleGroup {
  if (['goal', 'audience', 'entry_level', 'constraints'].includes(id) || id.startsWith('task-'))
    return 'intent';
  if (s.outcomes.some((o) => o.id === id)) return 'outcomes';
  if (s.assessments.some((a) => a.id === id || `criterion:${a.id}` === id)) return 'assessment';
  if (
    ['hours', 'calendar'].includes(id) ||
    id.startsWith('hours:') ||
    s.conflicts.some((c) => c.id === id)
  )
    return 'time';
  return 'topics';
}

// В данных нет названий модулей, поэтому модуль узнают по номеру и входящим в него темам.
export function moduleHeading(s: Skeleton, moduleId: string): string {
  const modules = [...new Set(s.topics.map((t) => t.module_id))];
  const titles = s.topics.filter((t) => t.module_id === moduleId).map((t) => t.title);
  return `Модуль ${modules.indexOf(moduleId) + 1}: ${titles.join(', ')}`;
}

// Практику относим к модулю её темы, связь порядка — к модулю темы, которой нужна предпосылка.
export function elementModuleId(s: Skeleton, id: string): string | undefined {
  if (s.topics.some((t) => t.module_id === id)) return id;
  const topicId = id.startsWith('dependency:')
    ? id.split(':')[2]
    : s.activities.find((a) => a.id === id)?.topic_id || id;
  return s.topics.find((t) => t.id === topicId)?.module_id;
}

export function elementName(s: Skeleton, e: SkeletonElement): string {
  const outcome = s.outcomes.find((o) => o.id === e.id);
  if (outcome) return outcome.description;
  const activity = s.activities.find((a) => a.id === e.id);
  if (activity)
    return `Практика: ${s.topics.find((t) => t.id === activity.topic_id)?.title || 'задание'}`;
  const assessment = s.assessments.find((a) => a.id === e.id || `criterion:${a.id}` === e.id);
  if (assessment)
    return `${e.id === assessment.id ? assessmentLabels[assessment.type] : 'Критерий'}: ${s.topics.find((t) => t.id === assessment.topic_id)?.title || 'итоговая работа'}`;
  if (e.id.startsWith('task-')) return `Задача ${e.id.slice(5)}`;
  if (e.id.startsWith('dependency:')) {
    const topics = s.topics.filter((t) => e.related.includes(t.id));
    return `Порядок: ${e.related.map((id) => topics.find((t) => t.id === id)?.title || 'тема').join(' → ')}`;
  }
  if (s.topics.some((t) => t.module_id === e.id)) return moduleHeading(s, e.id);
  return e.title;
}

// Представление старых записей меняется без перезаписи сохранённых версий и их хешей.
export function readableRationaleText(s: Skeleton, value: string): string {
  const names: [string, string][] = [
    ...s.topics.map((t): [string, string] => [t.id, `«${t.title}»`]),
    ...s.outcomes.map((o, i): [string, string] => [o.id, `результат ${i + 1}`]),
    ...s.activities.map((a, i): [string, string] => [a.id, `практическое задание ${i + 1}`]),
    ...s.assessments.map((a, i): [string, string] => [a.id, `проверочная работа ${i + 1}`]),
  ];
  let result = value;
  for (const [id, name] of names.sort((a, b) => b[0].length - a[0].length))
    result = result.replaceAll(id, name);
  return result
    .replaceAll('Пример с подцелями', 'Пример с пошаговым разбором')
    .replaceAll('time_budgets', 'распределении времени по заданиям')
    .replaceAll('точные строковые Decimal', 'проверено сложением часов')
    .replaceAll('Основание не найдено; требуется проверка', 'Пояснение пока не добавлено')
    .replaceAll(
      'Предложение демонстрационного проектировщика; необходимость требует предметной проверки.',
      'Предложение из готового примера. Преподавателю нужно проверить, подходит ли оно группе.',
    )
    .replaceAll('Сохранено условие запроса.', 'Это условие указано в вашем запросе.');
}

export function elementDecision(s: Skeleton, e: SkeletonElement): string {
  const topic = s.topics.find((t) => `hours:${t.id}` === e.id);
  if (topic)
    return `Всего ${hours(topic.planned_total)}. ${Object.entries(topic.hours)
      .filter(([, value]) => Number(value) > 0)
      .map(([kind, value]) => `${hourLabels[kind as keyof typeof hourLabels]} — ${hours(value)}`)
      .join('; ')}.`;
  if (e.id === 'calendar') {
    const c = s.requirements.calendar;
    return [
      c.description || 'Расписание ещё не согласовано.',
      c.start ? `Начало: ${c.start.split('-').reverse().join('.')}.` : 'Дата начала не выбрана.',
      c.daily_limit
        ? `Нагрузка — до ${hours(c.daily_limit)} в день.`
        : 'Дневную нагрузку нужно уточнить.',
      c.weekdays_only ? 'Занятия только по будням.' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (e.id === 'hours')
    return `В запросе — ${hours(s.requirements.total_hours)}. В учебном плане — ${hours(sumHours(s.topics.map((t) => t.planned_total)))}.`;
  const conflict = s.conflicts.find((c) => c.id === e.id);
  if (conflict)
    return `${conflict.expected}. ${conflict.actual}. ${conflict.calculation}${conflict.decision ? ` Выбран вариант: ${conflict.options.find((o) => o.id === conflict.decision?.option_id)?.title || 'решение сохранено'}.` : ''}`;
  const assessment = s.assessments.find((a) => a.id === e.id);
  if (assessment)
    return `${readableRationaleText(s, assessment.action)}. Критерий оценки: ${readableRationaleText(s, assessment.criterion)}`;
  return readableRationaleText(s, e.decision) || 'Пока не указано.';
}

export function rationaleSummary(
  s: Skeleton,
  e: SkeletonElement,
  records: Rationale[],
  signature: string,
) {
  const supported = records.find((r) => rationaleIsSupported(s, r, signature));
  const stale = records.some((r) => r.status === 'stale');
  const research = records.find((r) => ['research', 'subject_reference'].includes(r.kind));
  const group: RationaleKind = s.activities.some((a) => a.id === e.id)
    ? 'practice'
    : rationaleGroup(s, e.id);
  const prompts: Record<RationaleKind, string> = {
    intent: 'Обсудите с заказчиком, подходит ли цель и учтён ли опыт будущих участников.',
    outcomes:
      'Попросите преподавателя оценить, смогут ли участники выполнить это действие к концу курса.',
    topics:
      'Проверьте, что до этой темы участники уже освоили нужные навыки и смогут выполнить задание.',
    practice:
      'Попробуйте задание с участниками нужного уровня: понятны ли шаги и хватает ли времени?',
    assessment:
      'Проверьте, что работа действительно показывает нужный навык, а по критерию понятно, как её оценивать.',
    time: 'Оцените время на объяснение, самостоятельную работу и разбор ошибок. Согласуйте длительность учебного часа.',
  };
  const contexts: Record<RationaleKind, string> = {
    intent:
      'Здесь собраны исходные условия курса. Они помогают выбрать содержание и сложность заданий.',
    outcomes:
      'Этот результат описывает действие, которому предлагается научить участников. Задания должны позволять увидеть, освоено ли оно.',
    topics:
      'Это часть предложенного учебного плана. Её необходимость и место в программе ещё предстоит обсудить с преподавателем.',
    practice:
      'Это задание предложено для отработки навыка. Проверьте, что оно помогает освоить связанный с ним результат.',
    assessment:
      'Так предлагается проверять обучение. Важно, чтобы участник показывал умение на деле, а критерий позволял оценить работу.',
    time: 'Так время распределено в текущем плане. Совпадение общей суммы с запросом ещё не показывает, хватит ли времени на обучение.',
  };
  const custom = records.find((r) => r.purpose && !r.purpose.startsWith('Для аудитории «'));
  let why = custom ? readableRationaleText(s, custom.purpose) : contexts[group];
  if (supported?.kind === 'request')
    why =
      'Это условие взято из вашего запроса. Оно задаёт требования к курсу; возможность выполнить их ещё нужно оценить.';
  else if (research) {
    const exampleExplanations: Record<string, string> = {
      'research-subgoals-2020':
        'Сначала участник разбирает готовый пример по шагам, а потом пробует решить задачу сам. Такой подход исследовали на студентах вводного курса программирования. Подойдёт ли он этой группе и хватит ли времени, ещё нужно проверить.',
      'research-biggs-1996':
        'Результат обучения нужно связать с практикой и проверкой: участник тренирует нужное действие, а затем показывает его в работе. Источник объясняет этот общий принцип. Подходят ли конкретные задания вашей группе, должен оценить преподаватель.',
      'method-ubd-2014':
        'Сначала определяют, что участник должен уметь, затем выбирают работу, на которой он это покажет. Источник объясняет такой порядок подготовки курса. Содержание задания и критерий оценки ещё нужно проверить.',
    };
    why = research.applicability.startsWith('Поддерживает выбор ')
      ? exampleExplanations[research.source_id || ''] ||
        readableRationaleText(s, research.applicability)
      : readableRationaleText(s, research.applicability);
  }
  if (!records.length)
    return {
      label: 'Нет пояснения',
      tone: 'amber',
      why: 'Для этого решения ещё не записали, почему оно подходит курсу.',
      next: 'Добавьте источник или обсудите решение с преподавателем.',
      needsReview: true,
    };
  if (stale && !supported)
    return {
      label: 'Проверить заново',
      tone: 'amber',
      why,
      next: 'Условия курса изменились. Сверьте прежнее пояснение с новой аудиторией, результатами и нагрузкой.',
      needsReview: true,
    };
  const next = supported?.next_check || custom?.next_check || prompts[group];
  return {
    label: supported
      ? supported.kind === 'request'
        ? 'Из вашего запроса'
        : 'Есть подтверждение'
      : research
        ? 'Подтверждено частично'
        : 'Нужно обсудить',
    tone: supported ? 'green' : 'amber',
    why,
    next: readableRationaleText(s, next),
    needsReview: !supported,
  };
}
