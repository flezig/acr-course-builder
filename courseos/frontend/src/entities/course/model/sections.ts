import { isProfessionalStandardReference } from './professional-standards';
import type { Snapshot } from './schema';
import { formatHours, hourKinds } from '../../../shared/lib/decimal';
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

export function makeSections(snapshot: Snapshot): Snapshot['sections'] {
  const s = snapshot.skeleton;
  const r = s.requirements;
  const names = r.template_id === 'acr_general' ? generalSections : professionalSections;
  const outcomes = s.outcomes
    .map((o) => `${o.kind}: ${o.description}; глубина: ${o.depth}`)
    .join('\n');
  const plan = s.topics
    .map(
      (t) =>
        `${t.title}: ${formatHours(t.planned_total)} ч (${hourKinds.map((k) => `${k}: ${t.hours[k]}`).join(', ')}); контроль: ${t.control}`,
    )
    .join('\n');
  const assessments = s.assessments.map((a) => `${a.action} — ${a.criterion}`).join('\n');
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
          `${session.date}: ${s.topics.find((t) => t.id === session.topic_id)?.title}; ${hourKinds
            .filter((k) => Number(session.hours[k]) > 0)
            .map((k) => `${k} ${session.hours[k]} ч`)
            .join(', ')}`,
      )
      .join('\n') || '';
  return names.map((title, index) => {
    let fields: Field[];
    if (index === 0)
      fields = [
        field('Название', r.title),
        field('Реквизиты', 'Приказ ____; дата ____; подпись ____'),
      ];
    else if (/Кадров/.test(title))
      fields = [field('Преподаватели', 'ФИО ____; квалификация ____; должность ____')];
    else if (/Аннотац|Пояснительн/.test(title))
      fields = [
        field('Назначение', s.goal),
        field('Аудитория', r.audience),
        field('Форма', r.delivery),
        field('Объём', `${r.total_hours} ч`),
      ];
    else if (/Актуальност/.test(title))
      fields = [
        field(
          'Потребность аудитории',
          r.goal && r.audience ? `${r.audience}: ${r.goal}. Входной уровень: ${r.entry_level}` : '',
        ),
      ];
    else if (/Цель/.test(title))
      fields = [field('Цель', s.goal), field('Задачи', s.tasks.join('\n'))];
    else if (/результат|Знания/i.test(title)) fields = [field('Результаты обучения', outcomes)];
    else if (/Категори|Требования к слушател/.test(title))
      fields = [field('Аудитория', r.audience), field('Входной уровень', r.entry_level)];
    else if (/Сроки/.test(title))
      fields = [
        field('Начало', r.calendar.start),
        field(
          'Период',
          r.calendar.calendar_days
            ? `${r.calendar.calendar_days} календарных дней; ${r.total_hours} ч`
            : '',
        ),
      ];
    else if (/Форма обуч/.test(title))
      fields = [
        field('Форма', r.delivery),
        field('Организация занятий', s.topics.map((t) => `${t.title}: ${t.delivery}`).join('\n')),
      ];
    else if (/Объём/.test(title))
      fields = [
        field('Общий объём', `${r.total_hours} ч, итоговая аттестация включена`),
        field('Распределение', plan),
      ];
    else if (/Выдаваем/.test(title))
      fields = [
        field('Документ', 'Удостоверение о повышении квалификации; выдача по решению организации'),
      ];
    else if (/Календар/.test(title))
      fields = [field('Вместимость', r.calendar.description), field('Расписание', sessions)];
    else if (/Учебный план/.test(title)) fields = [field('Виды работы и объём', plan)];
    else if (/Учебно-тематическ/.test(title))
      fields = [
        field(
          'Темы и содержание',
          s.topics.map((t) => `${t.title} (${t.planned_total} ч): ${t.content}`).join('\n'),
        ),
      ];
    else if (/Рабочие программы/.test(title))
      fields = [
        field(
          'Программы модулей',
          snapshot.materials
            .filter((m) => m.type === 'working_program')
            .map((m) => m.content)
            .join('\n'),
        ),
      ];
    else if (/Основания|Нормативно-правовые/.test(title))
      fields = [field('Нормативные основания, проверенные организацией', '')];
    else if (/трудовые функции/.test(title))
      fields = [
        field(
          'Связи с трудовыми функциями',
          s.outcomes.every((o) => o.professional_standard_code)
            ? s.outcomes.map((o) => `${o.description}: ${o.professional_standard_code}`).join('\n')
            : '',
        ),
      ];
    else if (/удовлетворён/.test(title))
      fields = [
        field(
          'Анкета обратной связи',
          'До курса: ожидания и опыт. После курса: полезность заданий, нагрузка, трудности и предложения. Ответы без персональных данных.',
        ),
      ];
    else if (/контроль|аттестаци|оценка|Оценочные/i.test(title))
      fields = [
        field('Форма и критерии', `${r.assessment}\n${assessments}`),
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
    else if (/литератур|Интернет|Информацион|информацион/i.test(title))
      fields = [field('Проверенные источники по теме', literature)];
    else if (/Техническ|техническ|условия/.test(title))
      fields = [
        field(
          'Учебная среда',
          s.tools?.map((tool) => `${tool.name} ${tool.version}`).join('\n') || '',
        ),
        field('Подтверждённые рабочие места и доступы', ''),
      ];
    else if (/Методическ|Учебно-методическ|Организац/.test(title))
      fields = [
        field(
          'Учебные действия',
          s.activities
            .map((a) => `${s.topics.find((t) => t.id === a.topic_id)?.title}: ${a.description}`)
            .join('\n'),
        ),
        field('Обратная связь', assessments),
      ];
    else fields = [field('Содержание раздела', '')];
    return {
      id: `section-${index}`,
      title,
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
