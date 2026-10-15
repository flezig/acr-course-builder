import Decimal from 'decimal.js';
import { initializeRationales } from './rationale';
import { addMethodologyRationales } from './methodology';
import type { Requirements, Skeleton, Material, Snapshot } from './schema';
import { calendarCalculation, calendarSummary, hourTotals } from './rules';
import { contentHash, sumHours } from '../../../shared/lib/decimal';
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
export function scenarioKind(
  requirements: Requirements,
): 'devops' | 'bank' | 'teachers' | 'security' | 'python' | 'generic' {
  const title = requirements.title.toLowerCase();
  if (title.includes('devops') || requirements.delivery.toLowerCase().includes('стажиров'))
    return 'devops';
  if (requirements.audience.toLowerCase().includes('банк')) return 'bank';
  if (requirements.audience.toLowerCase().includes('учител')) return 'teachers';
  if (title.includes('кибер') || title.includes('безопасност')) return 'security';
  if (title.includes('python') && requirements.template_id === 'acr_general') return 'python';
  return 'generic';
}
export function makeSkeleton(requirements: Requirements, previous?: Skeleton): Skeleton {
  const kind = scenarioKind(requirements);
  const names =
    kind === 'devops'
      ? [
          'Linux и командная строка',
          'Сети и диагностика',
          'Контейнеризация',
          'CI/CD',
          'Мониторинг',
          'Инфраструктура как код',
        ]
      : kind === 'bank'
        ? [
            'Основы Python после Excel',
            'pandas: очистка и фильтрация',
            'Визуализация банковских данных',
            'SQL: выгрузка данных',
            'Основы статистики',
          ]
        : kind === 'teachers'
          ? [
              'Риски, этика и данные детей',
              'Запрос и проверка ответа ИИ',
              'План урока',
              'Задания для учеников',
              'Проверочная работа',
            ]
          : kind === 'security'
            ? [
                'Сети и модель угроз',
                'Linux и права доступа',
                'Журналы и диагностика',
                'Защита учебного стенда',
                'Разбор инцидента',
              ]
            : kind === 'python'
              ? [
                  'Знакомство с Python',
                  'Переменные и типы',
                  'Условия и выбор',
                  'Циклы и повторение',
                  'Строки и ввод',
                  'Функции и разбиение задачи',
                  'Сборка проекта',
                ]
              : Array.from(
                  {
                    length: Math.max(
                      3,
                      Math.min(32, Math.ceil(Number(requirements.total_hours) / 16)),
                    ),
                  },
                  (_, index) =>
                    `${index + 1}. ${['Основы', 'Разбор примера', 'Применение', 'Диагностика', 'Практикум', 'Самостоятельная задача'][index % 6]}: ${requirements.title}`,
                );
  const outcomes: Skeleton['outcomes'] =
    kind === 'python'
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
  // Assessment work is designed before content and time. Two methods are a case constraint.
  const finalType = kind === 'teachers' ? 'portfolio' : kind === 'security' ? 'exam' : 'project';
  const assessments: Skeleton['assessments'] = outcomes.flatMap((outcome, index) => [
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
  // Explicit case requirement in DevOps; estimates elsewhere, never a universal 2h rule.
  const finalHours =
    kind === 'devops'
      ? new Decimal(2)
      : kind === 'python'
        ? new Decimal(outcomes.length).times('.5').plus('.5')
        : new Decimal(assessments.filter((a) => a.topic_id === 'topic-final').length).times('.5');
  const remaining = new Decimal(requirements.total_hours).minus(finalHours);
  const base = names.map((_, i) =>
    kind === 'python' ? new Decimal([2, 2, 2, 2.5, 1.5, 2, 2][i]) : new Decimal(2 + (i % 3) * 0.75),
  );
  const baseTotal = new Decimal(sumHours(base.map((v) => v.toString())));
  const budgets: NonNullable<Skeleton['time_budgets']> = [];
  const topics: Skeleton['topics'] = names.map((title, index) => {
    const already = sumHours(
      budgets.map((b) =>
        sumHours([b.explanation, b.supported_practice, b.independent, b.feedback, b.assessment]),
      ),
    );
    const total =
      index === names.length - 1
        ? remaining.minus(already)
        : remaining.times(base[index]).div(baseTotal).toDecimalPlaces(4, Decimal.ROUND_DOWN);
    // Disjoint actions. Scale provisional action estimates to the requested envelope;
    // this is arithmetic accommodation, not evidence that the envelope is sufficient.
    const explanation = new Decimal(kind === 'python' && index === 0 ? '1' : '.5');
    const supported = kind === 'python' ? new Decimal('.5') : new Decimal('.75');
    const scale = total.div(base[index]);
    const e = explanation.times(scale).toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const p = supported.times(scale).toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const f = new Decimal('.25').times(scale).toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const formative = new Decimal('.125').times(scale).toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const independentTime = total.minus(e).minus(p).minus(f).minus(formative);
    budgets.push({
      topic_id: `topic-${index + 1}`,
      explanation: e.toString(),
      supported_practice: p.toString(),
      independent: independentTime.toString(),
      feedback: f.toString(),
      assessment: formative.toString(),
      basis: 'assumption',
      note: 'Непересекающиеся действия; разбор ошибок выделен отдельно, текущий контроль включён в практику/СРС. Предварительные оценки приведены к заданному объёму; замеров и подтверждения достаточности нет.',
    });
    const lecture = kind === 'devops' ? new Decimal(0) : e;
    const self =
      kind === 'devops'
        ? total
        : requirements.delivery.includes('заоч')
          ? independentTime
          : new Decimal(0);
    return {
      id: `topic-${index + 1}`,
      module_id: `module-${kind === 'python' ? (index < 4 ? 1 : 2) : index + 1}`,
      title,
      content: `Объяснение ${title.toLowerCase()}, выполнение учебной задачи, обратная связь и проверка результата.`,
      planned_total: total.toString(),
      hours: {
        lecture: lecture.toString(),
        practice: total.minus(lecture).minus(self).toString(),
        lab: '0',
        self_study: self.toString(),
        assessment: '0',
      },
      prerequisite_ids:
        kind === 'python'
          ? [
              [],
              ['topic-1'],
              ['topic-2'],
              ['topic-2', 'topic-3'],
              ['topic-2'],
              ['topic-2'],
              ['topic-3', 'topic-4', 'topic-5', 'topic-6'],
            ][index]
          : [],
      outcome_ids:
        kind === 'python'
          ? index < 2
            ? ['outcome-1']
            : index === 2
              ? ['outcome-2']
              : ['outcome-3']
          : [`outcome-${index + 1}`],
      delivery:
        kind === 'devops'
          ? 'Самостоятельная под наставником'
          : requirements.delivery.includes('заоч')
            ? 'Очно + дистанционная самостоятельная работа'
            : requirements.delivery,
      control: kind === 'devops' ? 'Собеседование + отчёт' : 'Тест + практическая защита',
    };
  });
  topics.push({
    id: 'topic-final',
    module_id: 'module-final',
    title: 'Итоговая аттестация',
    content: requirements.assessment,
    planned_total: finalHours.toString(),
    hours: {
      lecture: '0',
      practice: '0',
      lab: '0',
      self_study: '0',
      assessment: finalHours.toString(),
    },
    prerequisite_ids: kind === 'python' ? ['topic-7'] : [],
    outcome_ids: outcomes.map((o) => o.id),
    delivery: requirements.delivery,
    control: requirements.assessment,
  });
  budgets.push({
    topic_id: 'topic-final',
    explanation: '0',
    supported_practice: '0',
    independent: '0',
    feedback: '0',
    assessment: finalHours.toString(),
    basis: kind === 'devops' ? 'request' : 'assumption',
    note:
      kind === 'devops'
        ? 'Запрос: 2 ч аттестации; 254 ч СРС.'
        : 'Предварительная оценка: по 0.5 ч на демонстрацию и проверку каждого результата; для Python ещё 0.5 ч на общую защиту. Объём на группу/слушателя и длительности требуют эксперта и пилота.',
  });
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
          : `Разбор примера и самостоятельное выполнение: ${topic.title}; предметные шаги уточняет наставник.`,
    }));
  const skeleton: Skeleton = {
    schema_version: '1.0',
    normalization_version: 'canonical-decimal-v1',
    requirements,
    template_version: 'acr-2026-v1',
    goal: requirements.goal || `Освоить базовые действия по теме «${requirements.title}»`,
    tasks: [
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
    dependency_reasons: topics.flatMap((t) =>
      t.prerequisite_ids.map((from) => ({
        from_id: from,
        to_id: t.id,
        action:
          kind === 'python'
            ? {
                'topic-1': 'Запускает и меняет учебный скрипт, чтобы проверить присваивание',
                'topic-2': 'Читает и изменяет значение переменной для следующего задания',
                'topic-3': 'Проверяет условие выбора/завершения в следующем задании',
                'topic-4': 'Реализует повторение ходов до выхода в проекте',
                'topic-5': 'Читает строковую команду игрока в проекте',
                'topic-6': 'Вызывает выделенную функцию хода при сборке проекта',
                'topic-7': 'Собирает и запускает игру перед самостоятельной защитой',
              }[from] || ''
            : '',
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
  if (
    !requirements.calendar.confirmed ||
    !requirements.calendar.same_units ||
    !requirements.calendar.daily_limit ||
    !requirements.calendar.start ||
    requirements.calendar.calendar_days < 1 ||
    Number.isNaN(Date.parse(requirements.calendar.start)) ||
    new Decimal(requirements.calendar.daily_limit).lte(0)
  )
    skeleton.conflicts.push({
      id: 'calendar-unknown',
      requirement_ids: ['calendar', 'total_hours'],
      status: 'open',
      expected: 'Уточните календарь, учебные дни и одинаковые единицы часов',
      actual: requirements.calendar.description || 'Срок не задан',
      calculation: calendarSummary(requirements),
      options: [],
      decision: null,
    });
  else if (new Decimal(calculation.deficit).gt(0))
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
  skeleton.explanations = [
    {
      id: 'why-reachability',
      category: 'reachability',
      title: 'Достижимы ли результаты?',
      conclusion: `Для аудитории «${requirements.audience}» предусмотрено ${totals.practice} ч практики и ${totals.self_study} ч самостоятельной работы.`,
      detail: `Входной уровень: ${requirements.entry_level}. ${skeleton.outcomes.map((o) => `${o.description}: предпосылка — ${o.prerequisite}; глубина — ${o.depth}`).join('\n')} ${scenarioKind(requirements) === 'security' ? '72 часа дают начальные навыки на учебном стенде, но не гарантируют готовности к работе специалистом.' : 'Допущение: освоение возможно с подсказками и обратной связью. Достаточность времени оценивает эксперт.'}`,
      related_ids: ids,
      evidence: [
        evidence(
          'request',
          `Аудитория, входной уровень и ${requirements.total_hours} часов подтверждаются параметрами запроса`,
        ),
        evidence('assumption', 'Педагогическая достижимость не проверена экспертом'),
      ],
      status: 'needs_review',
      missing: 'Предметная оценка глубины и необходимой практики',
    },
    {
      id: 'why-sequence',
      category: 'sequence',
      title: 'Почему такой порядок тем?',
      conclusion: skeleton.topics
        .slice(0, 4)
        .map((t) => t.title)
        .join(' → '),
      detail: skeleton.topics
        .map(
          (t) =>
            `${t.id}: ${t.prerequisite_ids.length ? t.prerequisite_ids.map((from) => `${from}: ${skeleton.dependency_reasons?.find((d) => d.from_id === from && d.to_id === t.id)?.action || 'Основание не найдено; требуется проверка'}`).join('; ') : 'Зависимости не установлены; проверить входные навыки и предпосылки'}`,
        )
        .join('\n'),
      related_ids: skeleton.topics.map((t) => t.id),
      evidence: [
        evidence(
          'assumption',
          'Записанные зависимости указывают требуемые действия. Для общего сценария граф не выдумывается; предметные предпосылки ещё нужно выяснить',
        ),
      ],
      status: 'needs_review',
      missing: 'Проверка последовательности предметным экспертом',
    },
    {
      id: 'why-hours',
      category: 'hours',
      title: 'Как распределены часы?',
      conclusion: `${totals.lecture} + ${totals.practice} + ${totals.lab} + ${totals.self_study} + ${totals.assessment} = ${actual} ч`,
      detail: `Лекции → практика → лабораторные → самостоятельная → аттестация. Для темы время на объяснение записано в лекциях; освоение, отдельный разбор ошибок и текущий контроль — в практике/СРС; итоговая аттестация — отдельной строкой. Состав действий сохранён в time_budgets. Эти доли — методическое предположение. Аттестация входит один раз.`,
      related_ids: skeleton.topics.map((t) => t.id),
      evidence: [
        evidence(
          'calculation',
          `${actual} ${new Decimal(actual).eq(requirements.total_hours) ? '=' : '≠'} ${requirements.total_hours}; точные строковые Decimal`,
        ),
        evidence(
          'assumption',
          'Время на обратную связь включено в активность; длительность академического часа не предполагалась',
        ),
      ],
      status: new Decimal(actual).eq(requirements.total_hours) ? 'verified' : 'blocked',
      missing: 'Экспертная оценка достаточности распределения',
    },
    {
      id: 'why-assessment',
      category: 'assessment',
      title: 'Как проверяется каждый результат?',
      conclusion:
        'Каждый результат: активность, два разных средства, наблюдаемое действие и критерий.',
      detail: skeleton.outcomes
        .map(
          (o) =>
            `${o.id} — ${skeleton.assessments
              .filter((a) => a.outcome_ids.includes(o.id))
              .map((a) => `${a.type}: ${a.action}; критерий: ${a.criterion}`)
              .join('; ')}`,
        )
        .join('\n'),
      related_ids: [...ids, ...skeleton.assessments.map((a) => a.id)],
      evidence: [
        evidence(
          'calculation',
          'Два разных средства — условие кейса, не универсальное педагогическое правило. Количество типов проверяется кодом; содержательная валидность требует эксперта',
        ),
      ],
      status: skeleton.outcomes.every(
        (o) =>
          new Set(
            skeleton.assessments.filter((a) => a.outcome_ids.includes(o.id)).map((a) => a.type),
          ).size >= 2,
      )
        ? 'verified'
        : 'blocked',
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
