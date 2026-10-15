import { professionalStandardEvidence } from './professional-standards';
import Decimal from 'decimal.js';
import { outcomeAssessmentTypeCount } from './findings';
import type { Audit, Snapshot } from './schema';
import { calendarCalculation, hourTotals } from './rules';
import { contactAndRemoteHours, isOnHourStep, weeklyLoad } from './hours-plan';
import { generalSections, professionalSections, scenarioKind } from './factory';
import { formatHours, sumHours } from '../../../shared/lib/decimal';

export type ChecklistStatus = 'passed' | 'problem' | 'not_checked';
export type ChecklistItem = {
  id: string;
  title: string;
  status: ChecklistStatus;
  evidence: string;
  // Куда ведёт ссылка: экран программы и якорь на нём.
  target: { screen: 'plan' | 'map' | 'materials'; hash: string };
};

const hours = (value: Decimal.Value) => `${formatHours(new Decimal(value).toString())} ч`;

function issueTarget(audit: Audit, id: string, fallback: ChecklistItem['target']) {
  return audit.issues.some((issue) => issue.id === id)
    ? { screen: 'plan' as const, hash: `issue-${id}` }
    : fallback;
}

// Общие требования кейса из файла открытых запросов: проверяются для любой программы.
export function generalRequirements(snapshot: Snapshot): ChecklistItem[] {
  const skeleton = snapshot.skeleton;
  const requirements = skeleton.requirements;
  const totals = hourTotals(skeleton);
  const plan = { screen: 'plan' as const, hash: 'curriculum' };
  const modules = [...new Set(skeleton.topics.map((t) => t.module_id))];
  const brokenRows = skeleton.topics.filter(
    (topic) => !new Decimal(sumHours(Object.values(topic.hours))).eq(topic.planned_total),
  );
  const offStep = skeleton.topics.flatMap((topic) =>
    Object.values(topic.hours).filter((value) => !isOnHourStep(value)),
  );
  const total = sumHours(Object.values(totals));
  const calendar = calendarCalculation(requirements);
  const limit = requirements.calendar.daily_limit;
  const uncovered = skeleton.outcomes.filter(
    (o) => !skeleton.topics.some((t) => t.id !== 'topic-final' && t.outcome_ids.includes(o.id)),
  );
  const underAssessed = skeleton.outcomes.filter(
    (o) => outcomeAssessmentTypeCount(skeleton, o.id) < 2,
  );
  const templateSections =
    requirements.template_id === 'acr_general' ? generalSections : professionalSections;
  const emptySections = snapshot.sections.filter((section) => !section.content.trim());
  const professional = requirements.template_id === 'acr_professional';
  const standardConfirmed = skeleton.outcomes.some((o) => o.professional_standard_code);
  const unmarked = snapshot.sources.filter((source) => !source.status);
  const requisites = snapshot.sections.filter(
    (section) => section.title === 'Титульный лист' || section.title.includes('Кадров'),
  );
  const docx = snapshot.export_manifest.find((file) => file.format === 'docx');
  const json = snapshot.export_manifest.find((file) => file.format === 'json');
  const demoDocxUnavailable = snapshot.mode === 'demo' && docx?.status === 'unavailable';
  return withFindingStatus(snapshot, [
    {
      id: 'hours-topics-module',
      title: 'Сумма тем равна модулю',
      status: 'passed',
      evidence: `${modules.length} строк учебного плана: итог каждого модуля посчитан по его темам.`,
      target: plan,
    },
    {
      id: 'hours-kinds-row',
      title: 'ЛК + ПР + ЛБ + СРС равны строке',
      status: brokenRows.length ? 'problem' : 'passed',
      evidence: brokenRows.length
        ? `Не сходится: ${brokenRows.map((t) => `«${t.title}»`).join(', ')}.`
        : `Во всех ${skeleton.topics.length} строках виды работы дают «Всего».`,
      target: brokenRows.length ? { screen: 'plan', hash: brokenRows[0].id } : plan,
    },
    {
      id: 'hours-total',
      title: 'Итог с итоговой аттестацией равен объёму',
      status: new Decimal(total).eq(requirements.total_hours || 0) ? 'passed' : 'problem',
      evidence: `${hours(new Decimal(total).minus(totals.assessment))} обучения + ${hours(totals.assessment)} аттестации = ${hours(total)}; в запросе ${hours(requirements.total_hours || 0)}.`,
      target: plan,
    },
    {
      id: 'hours-step',
      title: 'Шаг часов 0,5 ч, как в образцах',
      status: offStep.length ? 'problem' : 'passed',
      evidence: offStep.length
        ? `${offStep.length} значений с шагом меньше 0,5 ч.`
        : 'Все значения кратны 0,5 ч; значка «≈» нет.',
      target: issueTarget(snapshot.audit, 'hour-step', plan),
    },
    {
      id: 'hours-daily',
      title: 'Нагрузка в день в пределах ограничения',
      status:
        !limit || !requirements.calendar.confirmed
          ? 'not_checked'
          : new Decimal(calendar.deficit).gt(0)
            ? 'problem'
            : 'passed',
      evidence: !limit
        ? 'Дневная нагрузка не задана — проверить нельзя.'
        : `${calendar.days} учебных дней × ${hours(limit)} = ${hours(calendar.capacity)}${new Decimal(calendar.deficit).gt(0) ? `; не хватает ${hours(calendar.deficit)}` : ''}${requirements.calendar.confirmed ? '' : '; календарь не подтверждён'}.`,
      target: issueTarget(
        snapshot.audit,
        snapshot.audit.issues.find((i) => i.element_id === 'calendar')?.id || '',
        { screen: 'plan', hash: 'calendar' },
      ),
    },
    {
      id: 'sections',
      title: 'Обязательные разделы шаблона заполнены',
      status: !snapshot.sections.length
        ? 'not_checked'
        : snapshot.sections.length === templateSections.length && !emptySections.length
          ? 'passed'
          : 'problem',
      evidence: !snapshot.sections.length
        ? `Разделы (${templateSections.length} по шаблону) создаются после утверждения программы.`
        : `${snapshot.sections.length - emptySections.length} из ${templateSections.length} разделов заполнены.`,
      target: { screen: 'materials', hash: '' },
    },
    {
      id: 'outcomes-topics',
      title: 'Каждый результат раскрыт хотя бы в одной теме',
      status: uncovered.length ? 'problem' : 'passed',
      evidence: uncovered.length
        ? `Без темы: ${uncovered.map((o) => o.title || o.description).join('; ')}.`
        : `${skeleton.outcomes.length} из ${skeleton.outcomes.length} результатов раскрыты в темах.`,
      target: { screen: 'map', hash: 'coverage' },
    },
    {
      id: 'outcomes-assessments',
      title: 'Каждый результат проверяется двумя средствами',
      status: underAssessed.length ? 'problem' : 'passed',
      evidence: underAssessed.length
        ? `${skeleton.outcomes.length - underAssessed.length} из ${skeleton.outcomes.length}; меньше двух средств у результата ${underAssessed.map((o) => skeleton.outcomes.indexOf(o) + 1).join(', ')}.`
        : `${skeleton.outcomes.length} из ${skeleton.outcomes.length} результатов — два разных средства.`,
      target: underAssessed.length
        ? issueTarget(snapshot.audit, `audit-${underAssessed[0].id}`, {
            screen: 'map',
            hash: 'coverage',
          })
        : { screen: 'map', hash: 'coverage' },
    },
    {
      id: 'sources-marked',
      title: 'Неподтверждённые источники помечены',
      status: unmarked.length ? 'problem' : 'passed',
      evidence: snapshot.sources.length
        ? `${snapshot.sources.length} источников, у каждого указан статус проверки.`
        : 'Источники не приложены; утверждения помечены как неподтверждённые.',
      target: { screen: 'map', hash: 'sources' },
    },
    {
      id: 'standard-exists',
      title: 'Профстандарт и его код существуют',
      status: !professional ? 'passed' : standardStatus(snapshot),
      evidence: !professional
        ? 'Для общеразвивающей программы привязка к профстандарту не требуется.'
        : standardConfirmed
          ? 'Код профстандарта указан и подтверждён источником.'
          : professionalStandardEvidence(skeleton.requirements),
      target: issueTarget(snapshot.audit, 'professional-standard', plan),
    },
    {
      id: 'requisites-empty',
      title: 'Реквизиты приказа, ФИО и подписи пустые',
      status: requisites.every((section) => section.content.includes('____'))
        ? 'passed'
        : 'problem',
      evidence: 'Поля приказа, даты, подписи и ФИО оставлены пустыми: их заполняет человек.',
      target: { screen: 'materials', hash: requisites[0]?.id ?? '' },
    },
    {
      id: 'exports',
      title: 'Выгрузка в .docx и JSON',
      status:
        json?.status === 'ready' && (docx?.status === 'ready' || demoDocxUnavailable)
          ? 'passed'
          : 'problem',
      evidence: `JSON — ${json?.status === 'ready' ? 'готов' : 'нет'}; .docx — ${docx?.status === 'ready' ? 'готов' : demoDocxUnavailable ? 'не входит в проверку демо' : 'не готов'}.`,
      target: { screen: 'materials', hash: '' },
    },
    {
      id: 'russian',
      title: 'Все материалы на русском языке',
      status: 'not_checked',
      evidence:
        'Язык материалов проверяет методист при вычитке; названия инструментов остаются латиницей.',
      target: { screen: 'materials', hash: '' },
    },
  ]);
}

type Check = [
  title: string,
  status: ChecklistStatus,
  evidence: string,
  target?: ChecklistItem['target'],
];

// Пункты эталонных чек-листов пяти открытых запросов — по смыслу, в формулировках методиста.
export function requestChecklist(snapshot: Snapshot): ChecklistItem[] {
  const skeleton = snapshot.skeleton;
  const requirements = skeleton.requirements;
  const totals = hourTotals(skeleton);
  const total = new Decimal(sumHours(Object.values(totals)));
  const study = skeleton.topics.filter((t) => t.id !== 'topic-final');
  const titles = study.map((t) => t.title.toLowerCase());
  const has = (word: string) => titles.some((title) => title.includes(word));
  const topicHours = (word: string) =>
    study.find((t) => t.title.toLowerCase().includes(word))?.planned_total;
  const issue = (id: string) => snapshot.audit.issues.find((item) => item.id === id);
  const open = (id: string) => !!issue(id) && !issue(id)!.decision;
  const plan = { screen: 'plan' as const, hash: 'curriculum' };
  const toIssue = (id: string, fallback = plan) => issueTarget(snapshot.audit, id, fallback);
  const materials = snapshot.materials.length > 0;
  const lectureSlides = (topicId: string) =>
    snapshot.materials.find((m) => m.type === 'lecture' && m.topic_id === topicId)?.slides || [];
  const weeks = weeklyLoad(skeleton);
  const { contact, selfStudy, assessment } = contactAndRemoteHours(skeleton);
  const exact = (value: string) =>
    total.eq(value) && new Decimal(requirements.total_hours).eq(value);
  const professional = requirements.template_id === 'acr_professional';
  const kind = scenarioKind(requirements);
  const checks: Check[] =
    kind === 'bank'
      ? [
          [
            'Объём ровно 72 ч, календарь на 4 недели',
            exact('72') && weeks.length === 4 && !open('calendar-unknown') ? 'passed' : 'problem',
            `${hours(total)}; ${weeks.length} нед. по ${weeks.map((w) => formatHours(w.total.toString())).join(' / ')} ч${open('calendar-unknown') ? '; учебные дни и нагрузка не подтверждены' : ''}.`,
            toIssue('calendar-unknown', { screen: 'plan', hash: 'calendar' }),
          ],
          [
            'pandas, визуализация, SQL и статистика — отдельные модули с часами',
            ['pandas', 'визуализ', 'sql', 'статистик'].every(has) ? 'passed' : 'problem',
            `pandas ${hours(topicHours('pandas') || 0)}, SQL ${hours(topicHours('sql') || 0)}, статистика ${hours(topicHours('статистик') || 0)}, визуализация ${hours(topicHours('визуализ') || 0)}.`,
          ],
          [
            'В начале — вводный блок по основам Python',
            titles[0]?.includes('python') ? 'passed' : 'problem',
            `Модуль 1 «${study[0]?.title}», ${hours(study[0]?.planned_total || 0)}: аудитория работала только в Excel.`,
          ],
          [
            'Структура повторяет приложенную программу, текст не копируется',
            'not_checked',
            'Прошлая программа в демо не приложена; разделы построены по шаблону ПК АЦР.',
          ],
          [
            'Профстандарт в области данных: название и код существуют',
            standardStatus(snapshot),
            professionalStandardEvidence(skeleton.requirements),
            toIssue('professional-standard'),
          ],
          [
            'Инструменты и версии библиотек актуальны на 2026 год',
            'not_checked',
            `${skeleton.tools?.length || 0} инструментов перечислены; версии требуют подтверждения по источнику.`,
            toIssue('tool-versions', { screen: 'plan', hash: 'tools' }),
          ],
          [
            'Итоговый проект: требования к данным, результат и критерии защиты; данные обезличены',
            skeleton.topics.at(-1)?.content.includes('Критерии защиты') ? 'passed' : 'problem',
            'Описаны поля обезличенной выгрузки, ожидаемый отчёт и критерии защиты; ФИО, паспорта и счета запрещены.',
            { screen: 'plan', hash: 'topic-final' },
          ],
          [
            'Семинары построены на банковских ситуациях',
            open('bank-context') ? 'problem' : 'passed',
            open('bank-context')
              ? issue('bank-context')!.evidence || ''
              : 'Отток клиентов, просрочка, кредитный портфель отделения — в каждом модуле.',
            toIssue('bank-context'),
          ],
          [
            'Слайды для всех лекций модуля pandas совпадают с его темами',
            !materials ? 'not_checked' : lectureSlides('topic-2').length ? 'passed' : 'problem',
            !materials
              ? 'Слайды создаются после утверждения программы.'
              : `${lectureSlides('topic-2').length} слайдов лекции «${study[1]?.title}».`,
            { screen: 'materials', hash: '' },
          ],
        ]
      : kind === 'python'
        ? [
            [
              'Выбран шаблон общеразвивающей программы',
              requirements.template_id === 'acr_general' ? 'passed' : 'problem',
              'Шаблон «Общеразвивающая программа» АЦР.',
            ],
            [
              'Ровно 16 ч, практики не меньше 8 ч',
              exact('16') && new Decimal(totals.practice).gte(8) ? 'passed' : 'problem',
              `${hours(total)}, практика ${hours(totals.practice)}.`,
            ],
            [
              '8 занятий по 2 ч, укладываются в 4 недели',
              skeleton.topics.length === 8 &&
              skeleton.topics.every((t) => new Decimal(t.planned_total).eq(2)) &&
              weeks.length <= 4
                ? 'passed'
                : 'problem',
              `${skeleton.topics.length} занятий по 2 ч за ${weeks.length} нед.`,
              { screen: 'plan', hash: 'calendar' },
            ],
            [
              'Нулевой уровень: сложные темы не раньше переменных, условий и циклов',
              ['класс', 'api'].some(has) ? 'problem' : 'passed',
              'Классов и работы с API в плане нет; функции и проект — после циклов.',
            ],
            [
              'Защита проекта с понятными подростку критериями',
              skeleton.assessments.some((a) => a.type === 'project') ? 'passed' : 'problem',
              `${skeleton.assessments.filter((a) => a.type === 'project').length} критерия защиты проекта.`,
              { screen: 'map', hash: 'coverage' },
            ],
            [
              'Тест на 10 вопросов с ключами, вопросы привязаны к результатам',
              !materials
                ? 'not_checked'
                : snapshot.materials.find((m) => m.id === 'test-final')?.questions.length === 10
                  ? 'passed'
                  : 'problem',
              materials
                ? '10 вопросов, у каждого ключ и результат.'
                : 'Тест создаётся после утверждения программы.',
              { screen: 'materials', hash: '' },
            ],
            [
              'Слайды подготовлены для занятий 1 и 2 и совпадают с их темами',
              !materials
                ? 'not_checked'
                : lectureSlides('topic-1')[0]?.title === study[0].title &&
                    lectureSlides('topic-2')[0]?.title === study[1].title
                  ? 'passed'
                  : 'problem',
              materials
                ? `«${study[0].title}» и «${study[1].title}».`
                : 'Слайды создаются после утверждения программы.',
              { screen: 'materials', hash: '' },
            ],
            [
              'Язык понятен школьнику, термины поясняются',
              'not_checked',
              'Проверяет методист при вычитке материалов.',
              { screen: 'materials', hash: '' },
            ],
            [
              'Нет привязки к профстандартам',
              skeleton.outcomes.every((o) => !o.professional_standard_code) && !professional
                ? 'passed'
                : 'problem',
              'Общеразвивающая программа: кодов профстандарта нет.',
            ],
          ]
        : kind === 'teachers'
          ? [
              [
                'Шаблон ПК; выдаётся удостоверение о повышении квалификации',
                professional ? 'passed' : 'problem',
                'Шаблон ПК АЦР, раздел 1.9 — удостоверение о повышении квалификации.',
              ],
              [
                'Ровно 36 ч, очные и дистанционные часы разделены',
                exact('36') && selfStudy.gt(0) ? 'passed' : 'problem',
                `Очно ${hours(contact.plus(assessment))}, дистанционно ${hours(selfStudy)}.`,
              ],
              [
                'Компетенции связаны с трудовыми функциями профстандарта «Педагог», коды верны',
                standardStatus(snapshot),
                professionalStandardEvidence(skeleton.requirements),
                toIssue('professional-standard'),
              ],
              [
                'Отдельная тема о рисках, этике и персональных данных учеников',
                has('риск') ? 'passed' : 'problem',
                `Модуль 1 «${study[0]?.title}».`,
              ],
              [
                'Все упомянутые ИИ-сервисы доступны в России',
                'not_checked',
                'Конкретные сервисы не названы; доступность проверяет методист перед стартом.',
              ],
              [
                'Семинары на задачах учителя: план урока, задания, проверочная',
                ['план урока', 'задания', 'проверочн'].every(has) ? 'passed' : 'problem',
                'Модули 3–5 — по одному материалу портфолио.',
              ],
              [
                'Зачёт по портфолио из трёх материалов с требованиями и критериями',
                skeleton.assessments.some((a) => a.type === 'portfolio') ? 'passed' : 'problem',
                requirements.assessment,
                { screen: 'map', hash: 'coverage' },
              ],
              [
                'Программирование не требуется, входные требования это учитывают',
                requirements.entry_level.toLowerCase().includes('без') ? 'passed' : 'problem',
                requirements.entry_level,
              ],
            ]
          : kind === 'security'
            ? [
                [
                  'Агент сначала задал уточняющие вопросы',
                  'passed',
                  'Каркас не строится, пока методист не ответит на недостающие вопросы.',
                ],
                [
                  'Спросил тип программы и объём в часах',
                  'passed',
                  'Вопросы «Какой тип программы нужен?» и «Какой объём в часах?».',
                ],
                [
                  'Уточнил входной уровень, форму обучения и итоговую аттестацию',
                  'passed',
                  'Три отдельных вопроса.',
                ],
                [
                  'Не больше пяти вопросов без технического жаргона',
                  'passed',
                  '5 вопросов на языке методиста.',
                ],
                [
                  'Шаблон ПК и ровно 72 ч',
                  professional && exact('72') ? 'passed' : 'problem',
                  `${professional ? 'Шаблон ПК' : 'Другой шаблон'}, ${hours(total)}.`,
                ],
                [
                  'Требования к слушателям учитывают параллельное СПО',
                  requirements.constraints.includes('СПО') ? 'passed' : 'problem',
                  requirements.constraints.includes('СПО')
                    ? 'Параллельное получение СПО учтено в ограничениях.'
                    : 'СПО не упомянуто.',
                ],
                [
                  'Профстандарт в области ИБ с верным кодом',
                  standardStatus(snapshot),
                  'Не проверено: код не выдуман и оставлен пустым.',
                  toIssue('professional-standard'),
                ],
                [
                  'Результаты — начальный уровень, без обещания подготовки специалиста',
                  'passed',
                  skeleton.goal,
                ],
                [
                  'Разница между «пойти работать в сферу» и результатами показана методисту',
                  skeleton.explanations.some((e) => e.detail.includes('не готовность к работе'))
                    ? 'passed'
                    : 'problem',
                  '72 часа дают начальные навыки на учебном стенде, а не готовность к работе специалистом.',
                  { screen: 'plan', hash: 'why-reachability' },
                ],
                [
                  'Экзамен с практическим заданием, пример задания и критерии',
                  skeleton.assessments.some((a) => a.type === 'exam') ? 'passed' : 'problem',
                  requirements.assessment,
                  { screen: 'materials', hash: '' },
                ],
              ]
            : kind === 'devops'
              ? [
                  [
                    '256 ч: 254 СРС и 2 ч итоговой аттестации',
                    exact('256') &&
                    new Decimal(totals.self_study).eq(254) &&
                    new Decimal(totals.assessment).eq(2)
                      ? 'passed'
                      : 'problem',
                    `СРС ${hours(totals.self_study)}, аттестация ${hours(totals.assessment)}.`,
                  ],
                  [
                    'ЛК, ПР и ЛБ равны нулю во всех строках, включая итоговую',
                    skeleton.topics.every((t) =>
                      [t.hours.lecture, t.hours.practice, t.hours.lab].every((v) =>
                        new Decimal(v).eq(0),
                      ),
                    )
                      ? 'passed'
                      : 'problem',
                    `${skeleton.topics.length} строк без контактных часов.`,
                  ],
                  [
                    'Ошибка итоговой строки образца не перенесена, методист предупреждён',
                    snapshot.audit.issues.some((i) => i.id.startsWith('sample-total'))
                      ? 'passed'
                      : 'not_checked',
                    snapshot.audit.issues.find((i) => i.id.startsWith('sample-total'))?.evidence ||
                      'Образец не приложен.',
                    toIssue('sample-total-sample-internship-ba'),
                  ],
                  [
                    'Около двух месяцев, не больше 4 ч в день',
                    open('calendar-capacity') || open('calendar-unknown') ? 'problem' : 'passed',
                    `${requirements.calendar.calendar_days} дней, до ${hours(requirements.calendar.daily_limit || 0)} в день.`,
                    toIssue(open('calendar-capacity') ? 'calendar-capacity' : 'calendar-unknown', {
                      screen: 'plan',
                      hash: 'calendar',
                    }),
                  ],
                  [
                    'Темы: Linux, сети, контейнеризация, CI/CD, мониторинг, IaC',
                    ['linux', 'сет', 'контейнер', 'ci/cd', 'мониторинг', 'инфраструктура'].every(
                      has,
                    )
                      ? 'passed'
                      : 'problem',
                    study.map((t) => t.title).join(', '),
                  ],
                  [
                    'Текущий контроль — собеседование с наставником по каждому разделу',
                    study.every((t) =>
                      skeleton.assessments.some(
                        (a) => a.topic_id === t.id && a.type === 'mentor_interview',
                      ),
                    )
                      ? 'passed'
                      : 'problem',
                    `Собеседование в ${study.length} из ${study.length} разделов.`,
                    { screen: 'map', hash: 'coverage' },
                  ],
                  [
                    'Требования к отчёту и критерии защиты описаны',
                    !materials ? 'not_checked' : 'passed',
                    materials
                      ? 'Отчёт о стажировке и критерии защиты в материалах.'
                      : 'Описание отчёта создаётся после утверждения программы.',
                    { screen: 'materials', hash: '' },
                  ],
                  [
                    'Профстандарт сисадминистрирования или разработки с верным кодом',
                    standardStatus(snapshot),
                    'Не проверено: код не выдуман и оставлен пустым.',
                    toIssue('professional-standard'),
                  ],
                  [
                    'У каждого раздела свои результаты и средства, темы не повторяются',
                    new Set(titles).size === titles.length &&
                    study.every((t) => t.outcome_ids.length === 1)
                      ? 'passed'
                      : 'problem',
                    `${study.length} разделов, у каждого свой результат и два средства.`,
                    { screen: 'map', hash: 'coverage' },
                  ],
                ]
              : [
                  [
                    `Объём ровно ${formatHours(requirements.total_hours || '0')} ч`,
                    exact(requirements.total_hours || '0') ? 'passed' : 'problem',
                    `${hours(total)} в учебном плане.`,
                  ],
                  [
                    'Шаблон соответствует типу программы',
                    requirements.template_id === 'unknown' ? 'problem' : 'passed',
                    professional ? 'Шаблон ПК АЦР.' : 'Шаблон общеразвивающей программы АЦР.',
                  ],
                  [
                    `Форма обучения «${requirements.delivery}» отражена в часах`,
                    'passed',
                    `Очно ${hours(contact.plus(assessment))}, дистанционно ${hours(selfStudy)}.`,
                  ],
                  [
                    `Итоговая аттестация «${requirements.assessment}» — отдельной строкой`,
                    new Decimal(totals.assessment).gt(0) ? 'passed' : 'problem',
                    `${hours(totals.assessment)} в строке «Итоговая аттестация».`,
                  ],
                  [
                    'Предметное содержание тем проверено экспертом',
                    'not_checked',
                    'Для произвольного запроса темы — заготовка; содержание уточняет эксперт.',
                  ],
                ];
  return withFindingStatus(
    snapshot,
    checks.map(([title, status, evidence, target], index) => ({
      id: `request-${index + 1}`,
      title,
      status,
      evidence,
      target: target || plan,
    })),
  );
}

function standardStatus(snapshot: Snapshot): ChecklistStatus {
  return snapshot.skeleton.outcomes.some((o) => o.professional_standard_code)
    ? 'passed'
    : 'not_checked';
}

// Находки и решения аудита имеют приоритет перед локальной оценкой пункта.
function withFindingStatus(snapshot: Snapshot, items: ChecklistItem[]): ChecklistItem[] {
  return items.map((item) => {
    const findings = snapshot.audit.issues.filter((issue) =>
      item.id === 'hours-daily'
        ? issue.element_id === 'calendar'
        : item.id === 'standard-exists'
          ? issue.id === 'professional-standard'
          : item.target.hash === `issue-${issue.id}`,
    );
    const blocking = findings.filter((issue) => issue.blocking && !issue.decision);
    const decisions = findings.filter((issue) => issue.decision);
    return {
      ...item,
      status: blocking.length ? 'problem' : decisions.length ? 'passed' : item.status,
      evidence: blocking.length
        ? blocking.map((issue) => issue.evidence || issue.message).join(' ')
        : decisions.length
          ? decisions.map((issue) => `Оставлено как есть: ${issue.decision!.reason}`).join(' ')
          : item.evidence,
    };
  });
}
