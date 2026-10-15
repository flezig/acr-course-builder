import Decimal from 'decimal.js';
import { initializeRationales } from './rationale';
import { addMethodologyRationales } from './methodology';
import type { Requirements, Skeleton, Material, Snapshot } from './schema';
import { calendarCalculation, calendarSummary, hourTotals } from './rules';
import { contentHash, formatHours, sumHours } from '../../../shared/lib/decimal';
import { assessmentLabels } from './presets';
import { distributeModuleHours, isInternship, selfStudyAllowed } from './hours-plan';
import {
  devopsTopics,
  finalHoursReason,
  genericTopics,
  pythonTopics,
  securityTopics,
  teacherTopics,
  type ScenarioKind,
  type ScenarioTopic,
} from './scenarios';
import {
  bankModuleAssessments,
  bankOutcomes,
  bankProject,
  bankProjectActions,
  bankTools,
  bankTopics,
} from './bank-scenario';
export const generalSections = [
  'Титульный лист',
  'Пояснительная записка',
  '1.1 Актуальность',
  '1.2 Категории обучающихся',
  '1.3 Цель и задачи',
  '1.4 Сроки реализации',
  '1.5 Знания, умения и навыки',
  '1.6 Календарный график',
  '2.1 Учебный план',
  '2.2 Учебно-тематический план',
  '2.3 Оценочные материалы',
  '2.4 Методические рекомендации',
  '3.1 Материально-технические условия',
  '3.2 Учебно-методическое обеспечение',
  '3.3.1 Основная литература',
  '3.3.2 Дополнительная литература',
  '3.3.3 Интернет-ресурсы',
  '3.4 Кадровое обеспечение',
];
export const professionalSections = [
  'Титульный лист',
  '1.1 Аннотация',
  '1.2 Цель реализации',
  '1.3 Результаты обучения',
  '1.4 Основания разработки',
  '1.5 Профессиональные компетенции и трудовые функции',
  '1.6 Требования к слушателям',
  '1.7 Форма обучения',
  '1.8 Объём',
  '1.9 Выдаваемый документ',
  '2.1 Учебный план',
  '2.2 Учебно-тематический план',
  '2.3 Календарный график',
  '2.4 Рабочие программы',
  '2.5 Текущая и итоговая оценка',
  '2.5.3 Анализ удовлетворённости',
  '3.1 Техническое обеспечение',
  '3.2 Информационное обеспечение и литература',
  '3.3 Организация обучения',
  '3.4 Кадровое обеспечение',
  'Приложение 1 Текущий контроль',
  'Приложение 2 Итоговая аттестация',
];
export function missingQuestions(requirements: Requirements) {
  return [
    ['template_id', 'Какой тип программы нужен?'],
    ['total_hours', 'Какой объём в часах?'],
    ['entry_level', 'Какой входной уровень слушателей?'],
    ['delivery', 'В какой форме проходит обучение?'],
    ['assessment', 'Какая итоговая аттестация предусмотрена?'],
  ]
    .filter(([field]) =>
      field === 'template_id'
        ? requirements.template_id === 'unknown'
        : !requirements[field as keyof Requirements],
    )
    .map(([field, label]) => ({ field, label }));
}
export function scenarioKind(requirements: Requirements): ScenarioKind {
  const title = requirements.title.toLowerCase();
  if (title.includes('devops') || isInternship(requirements)) return 'devops';
  if (requirements.audience.toLowerCase().includes('банк')) return 'bank';
  if (requirements.audience.toLowerCase().includes('учител')) return 'teachers';
  if (title.includes('кибер') || title.includes('безопасност')) return 'security';
  if (title.includes('python') && requirements.template_id === 'acr_general') return 'python';
  return 'generic';
}
function scenarioTopics(kind: ScenarioKind, requirements: Requirements): ScenarioTopic[] {
  return {
    devops: devopsTopics,
    bank: bankTopics,
    teachers: teacherTopics,
    security: securityTopics,
    python: pythonTopics,
    generic: genericTopics(requirements),
  }[kind];
}
// Итоговая аттестация — 2 ч во всех сценариях: в DevOps это требование запроса, в Python —
// восьмое занятие, в остальных — оценка, которая помечена как непроверенная.
const finalHours = new Decimal(2);
export function makeSkeleton(requirements: Requirements, previous?: Skeleton): Skeleton {
  const kind = scenarioKind(requirements);
  const design = scenarioTopics(kind, requirements);
  const names = design.map((topic) => topic.title);
  const outcomes: Skeleton['outcomes'] =
    kind === 'bank'
      ? structuredClone(bankOutcomes)
      : kind === 'python'
        ? [
            {
              id: 'outcome-1',
              kind: 'knowledge',
              description: 'Объясняет переменные и хранение состояния игры',
              prerequisite: 'Уверенное чтение и ввод текста',
              depth: 'Один небольшой сценарий',
              requirement_id: 'request',
              professional_standard_code: null,
            },
            {
              id: 'outcome-2',
              kind: 'skill',
              description: 'Применяет условия для выбора действий',
              prerequisite: 'Переменные и сравнения',
              depth: 'Две ветки условия',
              requirement_id: 'request',
              professional_standard_code: null,
            },
            {
              id: 'outcome-3',
              kind: 'proficiency',
              description: 'Создаёт цикл с корректным завершением',
              prerequisite: 'Условия и изменение переменной',
              depth: 'Один цикл в учебной программе',
              requirement_id: 'request',
              professional_standard_code: null,
            },
          ]
        : names.map((name, index) => ({
            id: `outcome-${index + 1}`,
            kind: (['knowledge', 'skill', 'proficiency'] as const)[index % 3],
            description: `Выполняет учебную задачу «${name}» и объясняет решение`,
            prerequisite: requirements.entry_level + '; предметные предпосылки требуют уточнения',
            depth: 'Базовое действие по образцу; требуется предметная проверка',
            requirement_id: 'request',
            professional_standard_code: null,
          }));
  // Оценивание проектируется до содержания и часов. Два разных средства — условие кейса.
  const finalType = kind === 'teachers' ? 'portfolio' : kind === 'security' ? 'exam' : 'project';
  const assessments: Skeleton['assessments'] =
    kind === 'bank'
      ? outcomes.flatMap((outcome, index) => {
          const current = bankModuleAssessments[index];
          return [
            ...(current
              ? [
                  {
                    id: `assessment-${index + 1}-a`,
                    topic_id: `topic-${current.topic}`,
                    outcome_ids: [outcome.id],
                    type: current.type,
                    action: current.action,
                    criterion: current.criterion,
                  },
                ]
              : []),
            {
              id: `assessment-${index + 1}-b`,
              topic_id: 'topic-final',
              outcome_ids: [outcome.id],
              type: 'project' as const,
              action: bankProjectActions[index],
              criterion: outcome.criteria!.join('; '),
            },
          ];
        })
      : outcomes.flatMap((outcome, index) => [
          {
            id: `assessment-${index + 1}-a`,
            topic_id: `topic-${kind === 'python' ? [2, 3, 4][index] : index + 1}`,
            outcome_ids: [outcome.id],
            type: kind === 'devops' ? 'mentor_interview' : 'test',
            action:
              kind === 'python'
                ? [
                    'Прослеживает значение переменной',
                    'Выбирает выполненную ветку',
                    'Определяет число повторений',
                  ][index]
                : `Объясняет решение по теме ${names[index]}`,
            criterion:
              kind === 'python'
                ? [
                    'Для двух присваиваний верно называет итоговое значение и объясняет изменение',
                    'Для истинного и ложного условия верно указывает выбранную ветку',
                    'На трассировке указывает число ходов и причину завершения',
                  ][index]
                : 'Воспроизводит пример и объясняет проверку ошибки; предметный порог требует уточнения',
          },
          {
            id: `assessment-${index + 1}-b`,
            topic_id: 'topic-final',
            outcome_ids: [outcome.id],
            type: finalType,
            action:
              kind === 'python'
                ? [
                    'Хранит состояние в переменных',
                    'Реализует два варианта выбора',
                    'Повторяет ход до условия выхода',
                  ][index]
                : `Демонстрирует действие: ${outcome.description}`,
            criterion:
              kind === 'python'
                ? [
                    'В новом фрагменте состояние сохраняется и меняется после хода; объясняет два изменения',
                    'Обе ветки выполняются на двух разных вводах; объясняет условие',
                    'Цикл делает несколько ходов и завершается по команде выхода; объясняет изменение состояния',
                  ][index]
                : 'Действие воспроизводится самостоятельно; результат объяснён; предметная рубрика требует проверки',
          },
        ]);
  const moduleHours = distributeModuleHours(requirements, design, finalHours);
  const blended = selfStudyAllowed(requirements) && !isInternship(requirements);
  const topics: Skeleton['topics'] = design.map((item, index) => ({
    id: `topic-${index + 1}`,
    module_id: `module-${item.module}`,
    title: item.title,
    content: item.content,
    planned_total: moduleHours[index].total.toString(),
    hours: {
      lecture: moduleHours[index].lecture.toString(),
      practice: moduleHours[index].practice.toString(),
      lab: '0',
      self_study: moduleHours[index].self_study.toString(),
      assessment: '0',
    },
    prerequisite_ids: item.prerequisites.map((number) => `topic-${number}`),
    outcome_ids: item.outcomes
      .filter((number) => number <= outcomes.length)
      .map((number) => `outcome-${number}`),
    delivery: isInternship(requirements)
      ? 'Самостоятельная работа под наставником'
      : blended
        ? 'Занятия очно, самостоятельная работа дистанционно'
        : requirements.delivery,
    control: item.control,
  }));
  topics.push({
    id: 'topic-final',
    module_id: 'module-final',
    title: 'Итоговая аттестация',
    content:
      kind === 'bank' ? `${requirements.assessment}.\n${bankProject}` : requirements.assessment,
    planned_total: finalHours.toString(),
    hours: {
      lecture: '0',
      practice: '0',
      lab: '0',
      self_study: '0',
      assessment: finalHours.toString(),
    },
    prerequisite_ids: [`topic-${design.length}`],
    outcome_ids: outcomes.map((o) => o.id),
    delivery: isInternship(requirements) ? 'Защита у наставника' : 'Очно',
    control: requirements.assessment,
  });
  // Состав учебных действий повторяет виды работы темы: отдельной дробной «раскладки»
  // по объяснению, практике и обратной связи больше нет, а причина решения хранится в note.
  const budgets: NonNullable<Skeleton['time_budgets']> = topics.map((topic, index) => ({
    topic_id: topic.id,
    explanation: topic.hours.lecture,
    supported_practice: sumHours([topic.hours.practice, topic.hours.lab]),
    independent: topic.hours.self_study,
    feedback: '0',
    assessment: topic.hours.assessment,
    basis: kind === 'devops' ? 'request' : 'assumption',
    note: topic.id === 'topic-final' ? finalHoursReason[kind] : moduleHours[index].reason,
  }));
  const activities = topics
    .filter((t) => t.id !== 'topic-final')
    .map((topic) => ({
      id: `activity-${topic.id}`,
      topic_id: topic.id,
      outcome_ids: topic.outcome_ids,
      description:
        kind === 'python'
          ? `Пример с подцелями «${topic.title}»: ${
              (
                {
                  'topic-1': 'открыть скрипт → предсказать вывод → запустить и сравнить',
                  'topic-2': 'вычислить значение → присвоить → изменить и проследить состояние',
                  'topic-3': 'вычислить условие → выбрать ветку → проверить два ввода',
                  'topic-4':
                    'задать состояние → проверить условие → выполнить ход → изменить состояние → проверить выход',
                  'topic-5': 'получить строку → сравнить команду → обработать ввод',
                  'topic-6': 'выделить действие → задать параметры → вызвать и проверить результат',
                  'topic-7': 'связать ввод, выбор и цикл → проверить два пути и выход',
                } as Record<string, string>
              )[topic.id]
            }. Затем выполнить с поддержкой, решить новый вариант самостоятельно и отдельно разобрать ошибки.`
          : kind === 'bank'
            ? `Разбор примера на данных отделения, затем семинар: ${topic.content.split('Семинар: ')[1] || 'работа над проектом с консультацией'}`
            : `Разбор примера и самостоятельное выполнение: ${topic.title}; предметные шаги уточняет наставник.`,
    }));
  const skeleton: Skeleton = {
    schema_version: '1.0',
    normalization_version: 'canonical-decimal-v1',
    requirements,
    template_version: 'acr-2026-v1',
    goal: requirements.goal || `Освоить базовые действия по теме «${requirements.title}»`,
    tasks:
      kind === 'bank'
        ? [
            'Перевести привычные расчёты Excel в воспроизводимые скрипты Python',
            'Научить выгружать и очищать данные по клиентам и кредитам без помощи аналитика',
            'Научить проверять, значимы ли различия показателей, и объяснять вывод руководителю',
          ]
        : [
            'Разобрать понятия на примере',
            'Отработать действия с обратной связью',
            'Продемонстрировать результат и объяснить решение',
          ],
    outcomes,
    topics,
    activities,
    assessments,
    explanations: [],
    time_budgets: budgets,
    ...(kind === 'bank' ? { tools: structuredClone(bankTools) } : {}),
    dependency_reasons: design.flatMap((item, index) =>
      item.prerequisites.map((from) => ({
        from_id: `topic-${from}`,
        to_id: `topic-${index + 1}`,
        action: item.dependency || '',
      })),
    ),
    conflicts: previous?.conflicts.filter((c) => c.decision).map((c) => structuredClone(c)) || [],
  };
  refreshExplanations(skeleton);
  initializeRationales(skeleton);
  addMethodologyRationales(skeleton, kind === 'python');
  return skeleton;
}
export function refreshExplanations(skeleton: Skeleton): Skeleton {
  const requirements = skeleton.requirements;
  const calculation = calendarCalculation(requirements);
  const totals = hourTotals(skeleton);
  const actual = sumHours(Object.values(totals));
  skeleton.conflicts = skeleton.conflicts.filter((c) => c.decision);
  if (!requirements.calendar.same_units)
    skeleton.conflicts.push({
      id: 'calendar-units',
      requirement_ids: ['calendar', 'total_hours'],
      status: 'open',
      expected:
        'Укажите продолжительность занятий в одной системе: академических или астрономических часах.',
      actual: 'Единицы часов программы и дневной нагрузки не согласованы',
      calculation: '',
      options: [],
      decision: null,
    });
  const options = [
    {
      id: 'extend',
      title: 'Продлить календарь',
      consequence: `Сохранить ${requirements.total_hours} часов и результаты; нужно ${calculation.needed ?? 'уточнить'} учебных дней. Выходные увеличивают календарный срок.`,
    },
    {
      id: 'reduce',
      title: 'Сократить объём',
      consequence: `Не более ${calculation.capacity} часов. Пересмотреть глубину результатов и задания, затем утвердить новую ревизию.`,
    },
    {
      id: 'raise',
      title: 'Изменить дневной лимит',
      consequence: `Не менее ${calculation.minimumLimit || 'уточнить'} ч/день. Это меняет исходное ограничение нагрузки; требуется явное решение.`,
    },
  ];
  const calendarIncomplete =
    !requirements.calendar.daily_limit ||
    !requirements.calendar.start ||
    requirements.calendar.calendar_days < 1 ||
    Number.isNaN(Date.parse(requirements.calendar.start)) ||
    new Decimal(requirements.calendar.daily_limit).lte(0);
  if (calendarIncomplete || !requirements.calendar.confirmed)
    skeleton.conflicts.push({
      id: 'calendar-unknown',
      requirement_ids: ['calendar', 'total_hours'],
      status: 'open',
      expected: calendarIncomplete
        ? 'Укажите учебные дни и нагрузку в календаре.'
        : 'Подтвердите учебные дни и нагрузку в календаре.',
      actual: calendarIncomplete
        ? requirements.calendar.description || 'Параметры календаря не заполнены или некорректны'
        : 'Параметры календаря указаны, но не подтверждены',
      calculation: calendarSummary(requirements),
      options: [],
      decision: null,
    });
  else if (requirements.calendar.same_units && new Decimal(calculation.deficit).gt(0))
    skeleton.conflicts.push({
      id: 'calendar-capacity',
      requirement_ids: ['calendar', 'total_hours', 'daily_limit'],
      status: 'open',
      expected: `Нужно минимум ${calculation.needed} учебных дня. Требуется решение методиста.`,
      actual: `Доступно ${calculation.days} дней; дефицит ${calculation.deficit} часа`,
      calculation: `ceil(${requirements.total_hours} / ${requirements.calendar.daily_limit}) = ${calculation.needed}; ${calculation.days} × ${requirements.calendar.daily_limit} = ${calculation.capacity}; ${requirements.total_hours} − ${calculation.capacity} = ${calculation.deficit}`,
      options,
      decision: null,
    });
  const ids = skeleton.outcomes.map((o) => o.id);
  const evidence = (type: 'request' | 'calculation' | 'assumption', text: string) => ({
    type,
    text,
    source_id: null,
  });
  // Достижимость показывается цепочкой «результат → задание → критерий → практика в теме».
  // Сами часы достижимость не доказывают, поэтому без задания и критерия результат «не проверен».
  const reachability = skeleton.outcomes.map((outcome, index) => {
    const tasks = skeleton.assessments.filter(
      (a) => a.outcome_ids.includes(outcome.id) && a.topic_id !== 'topic-final',
    );
    // В стажировке вся практика — самостоятельная работа под наставником.
    const practice = skeleton.topics
      .filter((t) => t.id !== 'topic-final' && t.outcome_ids.includes(outcome.id))
      .reduce(
        (sum, t) =>
          sum
            .plus(t.hours.practice)
            .plus(t.hours.lab)
            .plus(isInternship(requirements) ? t.hours.self_study : 0),
        new Decimal(0),
      );
    const linked = tasks.length > 0 && tasks.every((a) => a.criterion.trim()) && practice.gt(0);
    return {
      linked,
      line: linked
        ? `Результат ${index + 1}: ${tasks.map((a) => `${assessmentLabels[a.type].toLowerCase()} «${a.action}», критерий — ${a.criterion}`).join('; ')}; практики в темах результата — ${formatHours(practice.toString())} ч.`
        : `Результат ${index + 1}: не проверено — ${!tasks.length ? 'нет задания текущего контроля, проверяется только на итоговой аттестации' : 'в темах результата нет практики'}. Нужно задание с критерием в теме, где результат осваивается.`,
    };
  });
  const reasons = (skeleton.dependency_reasons || []).filter((d) => d.action.trim());
  const notes = (skeleton.time_budgets || []).filter((b) => b.topic_id !== 'topic-final');
  const unverifiedHours = notes.filter((b) => b.note.includes('не проверено'));
  const coveredTwice = skeleton.outcomes.filter(
    (o) =>
      new Set(skeleton.assessments.filter((a) => a.outcome_ids.includes(o.id)).map((a) => a.type))
        .size >= 2,
  );
  skeleton.explanations = [
    {
      id: 'why-reachability',
      category: 'reachability',
      title: 'Достижимы ли результаты?',
      conclusion: reachability.every((r) => r.linked)
        ? `У каждого из ${reachability.length} результатов есть задание с критерием и практика в теме, где он осваивается.`
        : `Связь «задание → критерий → практика» есть у ${reachability.filter((r) => r.linked).length} из ${reachability.length} результатов; остальные не проверены.`,
      detail: [
        `Входной уровень: ${requirements.entry_level || 'не указан'}.`,
        ...reachability.map((r) => r.line),
        scenarioKind(requirements) === 'security'
          ? '72 часа дают начальные навыки на учебном стенде, но не готовность к работе специалистом.'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      related_ids: ids,
      evidence: [
        evidence(
          'request',
          `Аудитория и входной уровень взяты из запроса: ${requirements.audience}`,
        ),
        evidence('assumption', 'Достаточность практики для этой аудитории не проверена на пилоте'),
      ],
      status: reachability.every((r) => r.linked) ? 'needs_review' : 'blocked',
      missing: 'Предметная оценка глубины результатов и пилот',
    },
    {
      id: 'why-sequence',
      category: 'sequence',
      title: 'Почему такой порядок тем?',
      conclusion: reasons.length
        ? (reasons.find((d) => d.action.startsWith('SQL после')) || reasons[0]).action
        : 'Не проверено: зависимости между темами не заданы, порядок нельзя обосновать.',
      detail: reasons.length
        ? reasons
            .map(
              (d) =>
                `${skeleton.topics.find((t) => t.id === d.from_id)?.title} → ${skeleton.topics.find((t) => t.id === d.to_id)?.title}: ${d.action}`,
            )
            .join('\n')
        : 'Укажите для каждой темы, какой навык предыдущей темы в ней нужен.',
      related_ids: skeleton.topics.map((t) => t.id),
      evidence: [
        evidence(
          'assumption',
          'Зависимости навыков выведены из содержания тем; предметный эксперт их не проверял',
        ),
      ],
      status: 'needs_review',
      missing: 'Проверка последовательности предметным экспертом',
    },
    {
      id: 'why-hours',
      category: 'hours',
      title: 'Почему часы распределены так?',
      conclusion: unverifiedHours.length
        ? `${unverifiedHours.length} из ${notes.length} решений по часам — оценка без обоснования, не проверено.`
        : heaviestModuleNote(skeleton) || 'Причины не записаны.',
      detail: notes
        .map((b) => `${skeleton.topics.find((t) => t.id === b.topic_id)?.title}: ${b.note}`)
        .join('\n'),
      related_ids: skeleton.topics.map((t) => t.id),
      evidence: [
        evidence(
          'calculation',
          new Decimal(actual).eq(requirements.total_hours || 0)
            ? 'Сумма тем и аттестации равна объёму запроса, все часы кратны 0,5'
            : 'Сумма тем и аттестации не равна объёму запроса',
        ),
      ],
      status: new Decimal(actual).eq(requirements.total_hours || 0)
        ? unverifiedHours.length
          ? 'needs_review'
          : 'verified'
        : 'blocked',
      missing: 'Экспертная оценка достаточности часов',
    },
    {
      id: 'why-assessment',
      category: 'assessment',
      title: 'Как проверяется каждый результат?',
      conclusion: `${coveredTwice.length} из ${skeleton.outcomes.length} результатов проверяются двумя разными средствами — так требует чек-лист кейса.`,
      detail: skeleton.outcomes
        .map(
          (o, index) =>
            `Результат ${index + 1}: ${
              skeleton.assessments
                .filter((a) => a.outcome_ids.includes(o.id))
                .map((a) => `${assessmentLabels[a.type]} — ${a.criterion}`)
                .join('; ') || 'средств нет'
            }`,
        )
        .join('\n'),
      related_ids: [...ids, ...skeleton.assessments.map((a) => a.id)],
      evidence: [
        evidence(
          'request',
          'Требование кейса: каждый результат проверяется хотя бы двумя оценочными средствами',
        ),
      ],
      status: coveredTwice.length === skeleton.outcomes.length ? 'verified' : 'blocked',
      missing: 'Смысловое соответствие критериев подтверждает эксперт',
    },
    {
      id: 'why-conflicts',
      category: 'conflicts',
      title: 'Какие пожелания несовместимы?',
      conclusion: skeleton.conflicts.some((c) => c.status === 'open')
        ? 'Есть блокирующее противоречие. Сначала требуется решение методиста.'
        : 'Вычислимых конфликтов не обнаружено.',
      detail:
        skeleton.conflicts.map((c) => `${c.expected}\n${c.calculation}`).join('\n') ||
        'Проверены часы, календарная вместимость и структурное покрытие. Педагогические ограничения требуют проверки человеком.',
      related_ids: ['calendar'],
      evidence: [evidence('calculation', calendarSummary(requirements))],
      status: skeleton.conflicts.some((c) => c.status === 'open') ? 'blocked' : 'verified',
      missing: '',
    },
  ];
  return skeleton;
}
// Для вывода берётся причина самого весомого модуля, при равенстве — самая частая:
// она объясняет большую часть объёма.
function heaviestModuleNote(skeleton: Skeleton) {
  const notes = (skeleton.time_budgets || []).filter((b) => b.topic_id !== 'topic-final');
  const total = (id: string) =>
    new Decimal(skeleton.topics.find((t) => t.id === id)?.planned_total || 0);
  const frequency = (note: string) => notes.filter((b) => b.note === note).length;
  return [...notes].sort(
    (a, b) =>
      total(b.topic_id).comparedTo(total(a.topic_id)) || frequency(b.note) - frequency(a.note),
  )[0]?.note;
}
const pythonQuestions = [
  [
    'Что хранит переменная score = 3?',
    ['Число 3', 'Текст score', 'Команду печати'],
    0,
    'Переменная — имя для значения; здесь это число 3.',
  ],
  [
    'Что выведет print(2 + 3)?',
    ['23', '5', '2 + 3'],
    1,
    'Два числовых значения складываются: получается 5.',
  ],
  [
    'Как получить текст от игрока?',
    ['input()', 'print()', 'break'],
    0,
    'input() читает введённую строку.',
  ],
  ['Чему равно 4 > 2?', ['False', 'True', '4'], 1, '4 больше 2, поэтому сравнение истинно.'],
  [
    'Когда выполняется блок if score > 0?',
    ['Всегда', 'При положительном score', 'Только при нуле'],
    1,
    'Блок if выполняется, если условие истинно.',
  ],
  [
    'Для чего нужен else?',
    ['Для другой ветки выбора', 'Для повторения', 'Для ввода'],
    0,
    'else выполняется, когда условие if ложно.',
  ],
  ['Сколько значений даёт range(3)?', ['2', '3', '4'], 1, 'range(3) даёт 0, 1, 2 — три значения.'],
  [
    'Что делает break в цикле?',
    ['Начинает заново', 'Завершает цикл', 'Меняет тип переменной'],
    1,
    'break прекращает ближайший цикл.',
  ],
  [
    'Почему условие while должно измениться?',
    ['Чтобы цикл завершился', 'Чтобы текст стал числом', 'Это не нужно'],
    0,
    'Без изменения состояния условие может всегда оставаться истинным.',
  ],
  [
    'Как проверить выбор выхода из игры?',
    ['Сравнить введённый текст с «выход»', 'Удалить переменную', 'Напечатать любой текст'],
    0,
    'Сравнение команды позволяет выбрать выход и завершить повторение.',
  ],
] as const;
export async function makeMaterials(skeleton: Skeleton): Promise<Material[]> {
  const kind = scenarioKind(skeleton.requirements);
  const materials: Material[] = [];
  const create = (
    topic: Skeleton['topics'][number],
    type: Material['type'],
    title: string,
    content: string,
    extra: Partial<Material> = {},
  ): Material => ({
    id: `${type}-${topic.id}`,
    module_id: topic.module_id,
    topic_id: topic.id,
    outcome_ids: topic.outcome_ids,
    assessment_id: null,
    type,
    title,
    content,
    expected: 'Действие воспроизводится и объясняется',
    criteria: [
      'Результат соответствует заданию',
      'Нет существенных ошибок',
      'Слушатель объясняет решение',
    ],
    questions: [],
    slides: [],
    source_ids: skeleton.requirements.references.map((s) => s.id),
    manual: false,
    stale: false,
    hash: '',
    ...extra,
  });
  for (const topic of skeleton.topics.filter((t) => t.id !== 'topic-final')) {
    materials.push(
      create(
        topic,
        'working_program',
        `Рабочая программа: ${topic.title}`,
        `Цель: ${skeleton.goal}.\nСодержание: ${topic.content}\nОбъём: ${sumHours(Object.values(topic.hours))} ч.\nОсвоение: ${skeleton.activities.find((a) => a.topic_id === topic.id)?.description}.\nТекущий контроль: ${topic.control}.\nМетодика: показать пример, выполнить с подсказками, повторить самостоятельно и обсудить ошибки.`,
      ),
    );
    if (kind !== 'devops')
      materials.push(
        create(
          topic,
          'seminar',
          `Практикум: ${topic.title}`,
          kind === 'python'
            ? `Учебные данные: игрок начинает с 3 жизнями. Введите выбор «налево» или «направо». Создайте фрагмент игры по теме «${topic.title}», проверьте два ввода и объясните изменившееся состояние.`
            : kind === 'bank'
              ? `Используйте условный обезличенный набор: client_id A01/A02/A03, debt 0/1200/500, overdue_days 0/30/5. По теме «${topic.title}» подготовьте шаг обработки, проверку пропусков и вывод без персональных данных.`
              : kind === 'teachers'
                ? `Для условного урока без данных учеников подготовьте ${topic.title.toLowerCase()}. Укажите класс, цель, запрос к разрешённому сервису (доступность предварительно проверить), ошибки ответа и исправленную версию.`
                : `На изолированном учебном примере выполните действие по теме «${topic.title}». Запишите исходные условия, шаги, ожидаемый результат и одну проверку ошибки.`,
          {
            expected:
              kind === 'python'
                ? 'Работающий фрагмент программы и два проверенных сценария ввода'
                : 'Артефакт, журнал проверки и объяснение решения',
          },
        ),
      );
    if (new Decimal(topic.hours.lecture).gt(0))
      materials.push(
        create(
          topic,
          'lecture',
          `Лекция: ${topic.title}`,
          `План: понятие → разобранный пример → типичная ошибка → самостоятельный шаг. Цель: ${topic.outcome_ids.join(', ')}.`,
          {
            slides: [
              {
                id: `slide-${topic.id}-1`,
                title: topic.title,
                bullets:
                  kind === 'python'
                    ? [
                        'Переменная хранит значение под именем',
                        'Условие выбирает действие',
                        'Цикл повторяет действия до выхода',
                      ]
                    : [
                        `Задача: ${topic.content}`,
                        'Сначала разобрать пример',
                        'Затем выполнить и проверить самостоятельно',
                      ],
                notes:
                  'Поясните термины простыми словами. Покажите один пример и попросите слушателя предсказать результат.',
              },
              {
                id: `slide-${topic.id}-2`,
                title: 'Разобранный пример и проверка',
                bullets:
                  kind === 'python'
                    ? [
                        'score = 3',
                        'if score > 0: print("Продолжаем")',
                        'Проверьте score = 0 и объясните отличие',
                      ]
                    : [
                        topic.title,
                        'Исходные условия → действие → результат',
                        'Какая проверка обнаружит ошибку?',
                      ],
                notes:
                  'Вместе проверьте два условия. Не переходите к следующей теме, пока слушатель не объяснит результат.',
              },
            ],
          },
        ),
      );
    if (kind === 'devops')
      materials.push(
        create(
          topic,
          'mentor_interview',
          `Собеседование: ${topic.title}`,
          `1. Какую задачу решает ${topic.title}?\n2. Покажите выполненный шаг на учебном сервисе.\n3. Как проверить ошибку и безопасно отменить действие?\n4. Какие сведения вы включите в отчёт?`,
          {
            assessment_id:
              skeleton.assessments.find(
                (a) => a.topic_id === topic.id && a.type === 'mentor_interview',
              )?.id || null,
            expected: 'Ответы с журналом действий и воспроизводимой демонстрацией',
          },
        ),
      );
  }
  const final = skeleton.topics.at(-1)!;
  const test = create(
    skeleton.topics[0],
    'test',
    'Итоговый тест с ключами',
    'Выберите один ответ. Ключ и объяснение видны методисту; для слушателей нужен отдельный экспорт.',
    {
      id: 'test-final',
      outcome_ids: skeleton.outcomes.map((o) => o.id),
      questions:
        kind === 'python'
          ? pythonQuestions.map((question, i) => ({
              id: `question-${i + 1}`,
              text: question[0],
              options: [...question[1]],
              correct_index: question[2],
              explanation: question[3],
              outcome_ids: [i < 3 ? 'outcome-1' : i < 6 ? 'outcome-2' : 'outcome-3'],
            }))
          : skeleton.outcomes.map((o, i) => ({
              id: `question-${i + 1}`,
              text: `Как проверить результат «${o.description}»?`,
              options: [
                'Воспроизвести действие и сопоставить с критерием',
                'Достаточно назвать инструмент',
                'Не проверять',
              ],
              correct_index: 0,
              explanation:
                'Проверка требует наблюдаемого действия, а не названия инструмента. Вопрос — демонстрационная структура; нужна предметная вычитка.',
              outcome_ids: [o.id],
            })),
    },
  );
  if (kind !== 'devops') materials.push(test);
  const finalType: Material['type'] =
    kind === 'teachers' ? 'portfolio' : kind === 'security' ? 'exam' : 'project';
  materials.push(
    create(
      final,
      finalType,
      kind === 'teachers'
        ? 'Портфолио из трёх материалов'
        : kind === 'security'
          ? 'Экзамен на учебном стенде'
          : kind === 'devops'
            ? 'Отчёт о стажировке и защита'
            : 'Итоговый проект',
      kind === 'python'
        ? 'Создайте простую игру или чат-бота: храните состояние в переменных, предусмотрите две ветки выбора и повторение до команды выхода. Внешний API допустим только после обсуждения с преподавателем. Демосценарий показывает последующее сужение проекта до текстовой игры.'
        : kind === 'teachers'
          ? 'Представьте три материала: план урока, задание ученикам и проверочную работу с ключами. Для каждого приложите цель, запрос без данных детей, ответ ИИ, найденные ошибки и исправленный вариант. Проверьте факты самостоятельно.'
          : kind === 'bank'
            ? 'На условных обезличенных данных подготовьте очистку в pandas, SQL-выгрузку, визуализацию и статистический вывод. Передайте notebook, словарь данных и объясните ограничения анализа. Не используйте реальные данные клиентов.'
            : kind === 'security'
              ? 'На изолированном стенде определите открытый сервис, проверьте права тестового пользователя, найдите событие в журнале и предложите защитную настройку. Работайте только в разрешённом стенде. Приложите журнал действий и восстановите исходное состояние.'
              : kind === 'devops'
                ? 'В отчёте опишите Linux, сеть, контейнер, CI/CD, мониторинг и инфраструктуру как код: исходное состояние, шаг, результат, проверка и откат. Приложите учебные конфигурации без секретов. На защите объясните решение наставнику.'
                : `Подготовьте учебный проект по теме «${skeleton.requirements.title}»: исходная задача, последовательность действий, результат, проверка и ограничения. Объём и предметное содержание проверяет эксперт.`,
      {
        id: 'project-final',
        outcome_ids: skeleton.outcomes.map((o) => o.id),
        assessment_id: skeleton.assessments.find((a) => a.topic_id === 'topic-final')?.id || null,
        expected:
          kind === 'teachers'
            ? 'Три проверенных материала и обоснование исправлений'
            : 'Артефакт, демонстрация и ответы на вопросы',
        criteria: skeleton.assessments
          .filter((a) => a.topic_id === 'topic-final')
          .map((a) => `${a.action}: ${a.criterion}`),
      },
    ),
  );
  for (const material of materials) material.hash = await materialHash(material);
  return materials;
}
export async function materialHash(material: Material) {
  const { hash: _hash, stale: _stale, manual: _manual, ...content } = material;
  return contentHash(content);
}
export function makeSections(snapshot: Snapshot): Snapshot['sections'] {
  const r = snapshot.skeleton.requirements;
  const names = r.template_id === 'acr_general' ? generalSections : professionalSections;
  return names.map((title, index) => ({
    id: `section-${index}`,
    title,
    content:
      index === 0
        ? `${r.title}\nЧерновик — требует проверки методистом. Приказ: ____; дата: ____; подпись: ____.`
        : title.includes('Кадров')
          ? 'По каждому модулю: ФИО ____; квалификация ____; должность ____. Подтверждённые сведения заполняет организация.'
          : title.includes('литератур') ||
              title.includes('Литератур') ||
              title.includes('Информацион') ||
              title.includes('Интернет')
            ? `${snapshot.sources.map((s) => `${s.name}: ${s.status}; ${s.claim}`).join('\n') || 'Основные, дополнительные и интернет-источники предстоит предоставить и проверить.'}\nСуществование и поддержка утверждений не подтверждены автоматически.`
            : title.includes('Основания') || title.includes('функции')
              ? 'Основания и коды профстандарта: не подтверждены. Расхождение №499/№266 из брифа требует согласования. Коды оставлены пустыми.'
              : title.includes('Выдаваем')
                ? 'Удостоверение о повышении квалификации; выдача по решению организации.'
                : title.includes('удовлетворён')
                  ? 'До и после курса: спросить ожидания, соответствие нагрузки, полезность задач и трудности; сохранить ответы без персональных данных.'
                  : title.includes('обеспеч') ||
                      title.includes('условия') ||
                      title.includes('Организация')
                    ? `Для формы «${r.delivery}» нужны рабочее место и учебная среда по теме ${r.title}. Доступы проверяются до начала. Работа: разобранный пример → активность → обратная связь → оценивание. Для стажировки наставник проверяет журнал; контактные часы остаются нулевыми.`
                    : title.includes('контроль') ||
                        title.includes('аттеста') ||
                        title.includes('оценка') ||
                        title.includes('Оценоч')
                      ? `${r.assessment}. Допуск: выполненные активности. Наблюдаемые критерии:\n${snapshot.skeleton.assessments.map((a) => `${a.action} — ${a.criterion}`).join('\n')}`
                      : `${r.title}. Аудитория: ${r.audience}; уровень: ${r.entry_level}.\nЦель: ${snapshot.skeleton.goal}.\n${r.total_hours} ч; ${r.calendar.description}.\n${snapshot.skeleton.topics.map((t) => `${t.title} — ${sumHours(Object.values(t.hours))} ч; ${t.control}`).join('\n')}\n${snapshot.skeleton.outcomes.map((o) => o.description).join('; ')}.\nМетодическое содержание — демонстрационный черновик, требует вычитки.`,
  }));
}
