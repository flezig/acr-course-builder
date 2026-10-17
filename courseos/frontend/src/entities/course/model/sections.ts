import { isProfessionalStandardReference } from './professional-standards';
import type { Snapshot } from './schema';
import { formatHours, hourKinds, hourLabels } from '../../../shared/lib/decimal';
import { plural } from '../../../shared/lib/plural';
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
  '2.5.1 Формы текущей и итоговой аттестации',
  '2.5.2 Оценочные материалы',
  '2.5.3 Анализ удовлетворённости',
  '3.1 Техническое обеспечение',
  '3.2.1 Нормативно-правовые документы',
  '3.2.2 Основная литература',
  '3.2.3 Дополнительная литература',
  '3.2.4 Интернет-ресурсы',
  '3.3 Организация обучения',
  '3.4 Кадровое обеспечение',
  'Приложение 1 Текущий контроль',
  'Приложение 2 Итоговая аттестация',
];

type Field = { label: string; value: string };
const field = (label: string, value: string): Field => ({ label, value });

// Тексты разделов пишутся связной прозой по образцам АЦР, но только из данных
// курса: цели, аудитории, тем, часов, расписания и оценивания. Реквизиты,
// литературу, нормативные основания и кадры агент не придумывает — эти поля
// остаются пустыми, и методист заполняет их сам.
// Строка, начинающаяся с «– », — пункт списка; остальные строки — абзацы.
// Аббревиатуры («ИТ», «SQL») не трогаются: вторая буква у них заглавная.
const lowerFirst = (text: string) =>
  /^[А-ЯЁ]([а-яё]|\s)/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
const withoutDot = (text: string) => text.trim().replace(/[.;]+$/, '');
const hoursText = (value: string) => {
  const hours = Number(value);
  return `${formatHours(value)} ${Number.isInteger(hours) ? plural(hours, ['час', 'часа', 'часов']) : 'часа'}`;
};
// «до 1 часа», «до 2 часов»: после «до» нужен родительный падеж.
const uptoHours = (value: string) => {
  const hours = Number(value);
  return `до ${formatHours(value)} ${hours % 10 === 1 && hours % 100 !== 11 ? 'часа' : 'часов'}`;
};
const academicHours = (value: string) => {
  const hours = Number(value);
  return `${formatHours(value)} ${Number.isInteger(hours) ? plural(hours, ['академический час', 'академических часа', 'академических часов']) : 'академического часа'}`;
};
const kindNames: Record<string, string> = {
  knowledge: 'Знания',
  skill: 'Умения',
  proficiency: 'Навыки',
};
const hourNames: Record<(typeof hourKinds)[number], string> = {
  lecture: 'лекционные занятия',
  practice: 'практические занятия',
  lab: 'лабораторные работы',
  self_study: 'самостоятельная работа',
  assessment: 'итоговая аттестация',
};
const formatIsoDate = (iso: string) => iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1');

export function makeSections(snapshot: Snapshot): Snapshot['sections'] {
  const s = snapshot.skeleton;
  const r = s.requirements;
  const general = r.template_id === 'acr_general';
  const names = general ? generalSections : professionalSections;
  const title = `«${r.title}»`;
  const goal = lowerFirst(withoutDot(s.goal));
  const audience = lowerFirst(withoutDot(r.audience));
  const entryLevel = lowerFirst(withoutDot(r.entry_level));
  const delivery = lowerFirst(withoutDot(r.delivery));
  const list = (items: string[]) => items.map((item) => `– ${withoutDot(item)}`);
  const totals = Object.fromEntries(
    hourKinds.map((k) => [k, s.topics.reduce((sum, t) => sum + Number(t.hours[k]), 0)]),
  ) as Record<(typeof hourKinds)[number], number>;
  const hourLines = hourKinds
    .filter((k) => totals[k] > 0)
    .map((k) => `– ${hourNames[k]} — ${hoursText(String(totals[k]))}`);
  const topicLines = (withHours: boolean) =>
    s.topics
      .filter((t) => t.module_id !== 'module-final')
      .map((t) => `– ${t.title}${withHours ? ` (${hoursText(t.planned_total)})` : ''}`);
  const outcomes = s.outcomes
    .map((o) => `${kindNames[o.kind]}: ${withoutDot(o.description)}`)
    .join('\n');
  // Строки учебного плана нужны для сверки часов в интерфейсе; в документе
  // их заменяет таблица учебного плана.
  const plan = s.topics
    .map(
      (t) =>
        `${t.title}: ${formatHours(t.planned_total)} ч (${hourKinds.map((k) => `${hourLabels[k]} ${formatHours(t.hours[k])}`).join(', ')}); контроль: ${t.control}`,
    )
    .join('\n');
  const criteria = s.assessments.map(
    (a) => `${withoutDot(a.action)}: ${lowerFirst(withoutDot(a.criterion))}`,
  );
  const currentControls = [
    ...new Set(
      s.topics.filter((t) => t.module_id !== 'module-final').map((t) => withoutDot(t.control)),
    ),
  ].filter(Boolean);
  const finalHours = s.topics
    .filter((t) => t.module_id === 'module-final')
    .reduce((sum, t) => sum + Number(t.planned_total), 0);
  const topicCount = s.topics.filter((t) => t.module_id !== 'module-final').length;
  const assessmentForms = [
    'Оценка качества освоения программы включает текущий контроль и итоговую аттестацию слушателей.',
    currentControls.length
      ? `Текущий контроль проводится по темам в форме: ${currentControls.map(lowerFirst).join('; ')}.`
      : '',
    `Итоговая аттестация${finalHours ? ` (${hoursText(String(finalHours))})` : ''} проводится в форме: ${lowerFirst(withoutDot(r.assessment))}.`,
    'К итоговой аттестации допускаются слушатели, выполнившие задания текущего контроля.',
  ].filter(Boolean);
  const generated = snapshot.generation?.program_sections;
  const candidates = (group: 'main' | 'additional' | 'internet') =>
    (generated?.literature ?? [])
      .filter((item) => item.group === group)
      .map((item) => `[НЕ ПОДТВЕРЖДЁН] ${item.citation}`)
      .join('\n');
  const literature = snapshot.sources
    .filter(
      (source) =>
        !isProfessionalStandardReference(source) &&
        source.provenance?.content === 'confirmed' &&
        source.provenance?.access === 'read',
    )
    .map((source) => `${source.name}; ${source.url || source.coordinate}; область: ${source.scope}`)
    .join('\n');
  const sessions =
    s.sessions
      ?.map(
        (session) =>
          `${formatIsoDate(session.date)}: ${s.topics.find((t) => t.id === session.topic_id)?.title}; ${hourKinds
            .filter((k) => Number(session.hours[k]) > 0)
            .map((k) => `${hourLabels[k]} ${formatHours(session.hours[k])} ч`)
            .join(', ')}`,
      )
      .join('\n') || '';
  const days = r.calendar.calendar_days;
  const studyDays = s.sessions?.length || 0;
  const regime = [
    days ? `Количество учебных недель – ${Math.ceil(days / 7)}.` : '',
    studyDays ? `Количество учебных дней – ${studyDays}.` : '',
    r.calendar.daily_limit ? `Режим занятий: ${uptoHours(r.calendar.daily_limit)} в день.` : '',
    r.calendar.description ? `${withoutDot(r.calendar.description)}.` : '',
    `Общая трудоёмкость программы — ${hoursText(r.total_hours)}.`,
  ].filter(Boolean);
  const activities = s.activities.map(
    (a) =>
      `– ${s.topics.find((t) => t.id === a.topic_id)?.title}: ${lowerFirst(withoutDot(a.description))}`,
  );
  const deliveries = [...new Set(s.topics.map((t) => withoutDot(t.delivery)))];
  const materialCounts = (
    [
      ['working_program', 'рабочие программы тем'],
      ['lecture', 'планы лекций и слайды'],
      ['seminar', 'материалы практических занятий'],
      ['test', 'тесты с ключами'],
      ['project', 'задания итогового проекта'],
      ['portfolio', 'требования к портфолио'],
      ['exam', 'материалы экзамена'],
      ['mentor_interview', 'вопросы собеседования с руководителем'],
    ] as const
  )
    .map(
      ([type, label]) => [label, snapshot.materials.filter((m) => m.type === type).length] as const,
    )
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `– ${label} (${count})`);

  return names.map((sectionTitle, index) => {
    let fields: Field[];
    const text = (label: string, lines: string[]) => [
      field(label, lines.filter(Boolean).join('\n')),
    ];
    if (index === 0)
      fields = [
        field('Название', r.title),
        field('Реквизиты', 'Приказ ____; дата ____; подпись ____'),
      ];
    else if (/Кадров/.test(sectionTitle))
      fields = [field('Преподаватели', 'ФИО ____; квалификация ____; должность ____')];
    else if (/Пояснительн/.test(sectionTitle))
      fields = text('Пояснительная записка', [
        `Дополнительная общеразвивающая программа ${title} имеет техническую направленность.`,
        `Программа предназначена для категории обучающихся: ${audience}. Её цель — ${goal}.`,
        `Содержание программы включает ${topicCount} ${plural(topicCount, ['тему', 'темы', 'тем'])}:`,
        ...topicLines(false),
        `Форма обучения: ${delivery}.`,
        `Трудоёмкость программы: ${hoursText(r.total_hours)}.`,
        `Итоговая аттестация: ${lowerFirst(withoutDot(r.assessment))}.`,
        'Документ, выдаваемый по итогам обучения: сертификат об освоении программы.',
      ]);
    else if (/Аннотац/.test(sectionTitle))
      fields = text('Аннотация', [
        `Программа ${title} направлена на совершенствование профессиональных компетенций слушателей для решения задачи «${withoutDot(s.goal)}».`,
        'Содержание программы охватывает следующие темы:',
        ...topicLines(false),
        `Итоговая аттестация проводится в форме: ${lowerFirst(withoutDot(r.assessment))}.`,
      ]);
    else if (/Актуальност/.test(sectionTitle))
      fields = text('Актуальность', [
        generated?.relevance ||
          (r.goal && r.audience
            ? `Актуальность программы обусловлена задачей обучения, поставленной заказчиком: «${withoutDot(s.goal)}». Программа рассчитана на категорию обучающихся «${audience}» и учитывает их входной уровень: ${entryLevel}. Каждая тема завершается практическим заданием, поэтому результат обучения проверяется на конкретных действиях слушателя.`
            : ''),
      ]);
    else if (/Цель/.test(sectionTitle))
      fields = text('Цель и задачи', [
        general
          ? `Цель программы – ${goal}.`
          : `Цель реализации программы – совершенствование профессиональных компетенций слушателей для решения задачи «${withoutDot(s.goal)}».`,
        'Реализация поставленной цели предусматривает решение следующих задач:',
        ...list(s.tasks),
      ]);
    else if (/результат|Знания/i.test(sectionTitle))
      fields = [field('Результаты обучения', outcomes)];
    else if (/Категори|Требования к слушател/.test(sectionTitle))
      fields = text('Категории слушателей', [
        general
          ? `Программа предназначена для категории обучающихся: ${audience}.`
          : `К освоению программы допускаются лица, имеющие среднее профессиональное и (или) высшее образование, а также лица, получающие среднее профессиональное и (или) высшее образование. Целевая категория слушателей: ${audience}.`,
        r.entry_level ? `Требования к входному уровню: ${entryLevel}.` : '',
      ]);
    else if (/Сроки/.test(sectionTitle))
      fields = text('Сроки реализации', [
        days
          ? `Срок реализации: ${days} ${plural(days, ['календарный день', 'календарных дня', 'календарных дней'])}${r.calendar.start ? `, начало обучения — ${formatIsoDate(r.calendar.start)}` : ''}.`
          : '',
        `Трудоёмкость: ${hoursText(r.total_hours)}.`,
        'Конкретные даты начала и окончания обучения, а также расписание занятий устанавливаются для каждой учебной группы приказом организации о зачислении и утверждённым расписанием.',
      ]);
    else if (/Форма обуч/.test(sectionTitle))
      fields = text('Форма обучения', [
        `Форма обучения: ${delivery}.`,
        deliveries.length > 1 ? 'Формы проведения занятий по темам:' : '',
        ...(deliveries.length > 1
          ? s.topics.map((t) => `– ${t.title}: ${lowerFirst(withoutDot(t.delivery))}`)
          : []),
      ]);
    else if (/Объём/.test(sectionTitle))
      fields = [
        field(
          'Общий объём',
          [
            `Объём программы — ${academicHours(r.total_hours)}, из них:`,
            ...hourLines,
            days
              ? `Срок обучения: ${days} ${plural(days, ['день', 'дня', 'дней'])}${r.calendar.daily_limit ? ` (${uptoHours(r.calendar.daily_limit)} в день)` : ''}.`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        ),
        field('Распределение', plan),
      ];
    else if (/Выдаваем/.test(sectionTitle))
      fields = [
        field('Документ', 'Удостоверение о повышении квалификации установленного образца.'),
      ];
    else if (/Календар/.test(sectionTitle))
      fields = [field('Режим занятий', regime.join('\n')), field('Расписание', sessions)];
    else if (/Учебный план/.test(sectionTitle)) fields = [field('Виды работы и объём', plan)];
    else if (/Учебно-тематическ/.test(sectionTitle))
      fields = [
        field(
          'Темы и содержание',
          s.topics
            .map((t) => `${t.title} (${hoursText(t.planned_total)}): ${withoutDot(t.content)}.`)
            .join('\n'),
        ),
      ];
    else if (/Рабочие программы/.test(sectionTitle))
      fields = [
        field(
          'Программы модулей',
          snapshot.materials
            .filter((m) => m.type === 'working_program')
            .map((m) => m.content)
            .join('\n'),
        ),
      ];
    else if (/Основания|Нормативно-правовые/.test(sectionTitle))
      fields = [field('Нормативные основания, проверенные организацией', '')];
    else if (/трудовые функции/.test(sectionTitle))
      fields = [
        field(
          'Связи с трудовыми функциями',
          s.outcomes.every((o) => o.professional_standard_code)
            ? s.outcomes.map((o) => `${o.description}: ${o.professional_standard_code}`).join('\n')
            : '',
        ),
      ];
    else if (/удовлетворён/.test(sectionTitle))
      fields = text('Анкетирование', [
        'До начала обучения по программе и по итогам обучения проводится анкетирование слушателей для анализа ожиданий и удовлетворённости требований к организации и качеству обучения.',
        'До начала обучения слушатели описывают ожидания и имеющийся опыт; после обучения оценивают полезность заданий, учебную нагрузку, трудности и дают предложения. Анкеты не содержат персональных данных.',
      ]);
    else if (/^Приложение 1/.test(sectionTitle))
      fields = text('Текущий контроль', [
        `Текущий контроль проводится по темам программы${currentControls.length ? ` в форме: ${currentControls.map(lowerFirst).join('; ')}` : ''}. Ниже приведены материалы практических занятий и тестов с ключами и критериями оценки.`,
      ]);
    else if (/^Приложение 2/.test(sectionTitle))
      fields = text('Итоговая аттестация', [
        `Итоговая аттестация проводится в форме: ${lowerFirst(withoutDot(r.assessment))}. Ниже приведены задания итоговой аттестации с критериями оценки.`,
      ]);
    else if (/Формы текущей/.test(sectionTitle)) fields = text('Формы аттестации', assessmentForms);
    else if (/контроль|аттестаци|оценка|Оценочные/i.test(sectionTitle))
      fields = [
        field(
          'Форма и критерии',
          // В ДООП формы аттестации описаны только здесь, в ДПП — в разделе 2.5.1.
          [
            ...(general ? assessmentForms : []),
            criteria.length ? 'Критерии оценивания результатов обучения:' : '',
            ...list(criteria),
          ]
            .filter(Boolean)
            .join('\n'),
        ),
        field(
          'Созданные оценочные материалы',
          snapshot.materials
            .filter((m) =>
              ['test', 'seminar', 'project', 'portfolio', 'exam', 'mentor_interview'].includes(
                m.type,
              ),
            )
            .map((m) => `${m.title}: ${m.expected}; ${m.criteria.join('; ')}`)
            .join('\n'),
        ),
      ];
    else if (/литератур|Интернет/i.test(sectionTitle)) {
      fields = [field('Проверенные источники по теме', literature)];
      // Источники от модели не засчитываются как проверенные: отдельное поле с пометкой.
      const group = /Основная/.test(sectionTitle)
        ? candidates('main')
        : /Дополнительная/.test(sectionTitle)
          ? candidates('additional')
          : /Интернет/.test(sectionTitle)
            ? candidates('internet')
            : '';
      if (group) fields.push(field('Предложено агентом, требует проверки', group));
    } else if (/Техническ|техническ|условия/.test(sectionTitle)) {
      const environment =
        s.tools?.map((tool) => `${tool.name} ${tool.version}`) ?? generated?.environment ?? [];
      fields = [
        field(
          'Учебная среда',
          environment.length
            ? [
                'Для реализации программы необходимо следующее программное обеспечение:',
                ...list(environment),
              ].join('\n')
            : '',
        ),
        field('Подтверждённые рабочие места и доступы', ''),
      ];
    } else if (/^2\.4 Методические/.test(sectionTitle))
      fields = text('Методические материалы', [
        generated?.methodical ?? '',
        'Каждая тема строится вокруг учебных действий слушателей:',
        ...activities,
        'Результаты заданий оцениваются по критериям, приведённым в разделе «Оценочные материалы»; ошибки разбираются на занятии, после чего слушатель выполняет похожее задание самостоятельно.',
      ]);
    else if (/Учебно-методическ|Информацион|информацион/.test(sectionTitle))
      fields = text('Учебно-методическое обеспечение', [
        materialCounts.length
          ? 'Комплект методических материалов, разработанный для программы:'
          : 'Комплект методических материалов формируется после утверждения структуры программы.',
        ...materialCounts,
      ]);
    else if (/Организац/.test(sectionTitle))
      fields = text('Организация обучения', [
        generated?.organization ?? '',
        `Обучение проводится в форме: ${delivery}. ${r.calendar.description ? `${withoutDot(r.calendar.description)}.` : ''}`.trim(),
        hourLines.length ? 'Учебная нагрузка распределяется по видам работы:' : '',
        ...hourLines,
        'Практическая часть строится на последовательном выполнении заданий по темам с обратной связью преподавателя; итоговая аттестация проводится после освоения всех тем.',
      ]);
    else fields = [field('Содержание раздела', '')];
    return {
      id: `section-${index}`,
      title: sectionTitle,
      fields,
      content: fields
        .map((f) => `${f.label}: ${f.value || 'Не заполнено — требуется решение методиста'}`)
        .join('\n'),
    };
  });
}

export function sectionCompleteness(snapshot: Snapshot) {
  const names =
    snapshot.skeleton.requirements.template_id === 'acr_general'
      ? generalSections
      : professionalSections;
  const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
  return names.map((title) => {
    const matches = snapshot.sections.filter((section) => section.title === title);
    const section = matches[0];
    const missing = !section?.fields?.length
      ? ['Структурированные поля раздела']
      : section.fields
          .filter(
            (f) =>
              !f.value.trim() ||
              /____|не заполнено|предстоит|заглушк/i.test(f.value) ||
              !section.content.includes(f.value),
          )
          .map((f) => f.label);
    const duplicate =
      section &&
      snapshot.sections.some(
        (other) =>
          other.id !== section.id && normalize(other.content) === normalize(section.content),
      );
    if (duplicate) missing.push('Собственное содержание раздела вместо повторяющегося текста');
    if (matches.length !== 1) missing.push('Один раздел выбранного образца');
    return { title, section, complete: missing.length === 0, missing };
  });
}
