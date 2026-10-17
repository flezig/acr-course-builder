import type { Material, Rationale, Snapshot } from '../model/schema';
import { contentQuestions } from '../model/demo-clarifications';
import { assessmentLabels, kindLabels } from '../model/presets';
import {
  currentRationales,
  missingBasis,
  rationaleCoverage,
  rationaleIsSupported,
  rationaleSignature,
  skeletonElements,
  sourceById,
} from '../model/rationale';
import { formatHours, hourKinds, hourLabels } from '../../../shared/lib/decimal';
import {
  curriculumRows,
  formatDates,
  moduleHeading,
  programTypeName,
  replacedSectionField,
  sectionTable,
  topicHeading,
  unconfirmedSources,
  usedHourKinds,
} from './curriculum';
import { outcomeCodes } from './outcome-codes';
import { approvedAtCreation, reviewItems } from './review-items';

// Markdown — читаемая версия всего комплекта для методиста: сначала то, что
// нужно проверить, затем программа и материалы, в конце обоснования решений
// и технические сведения для сверки с JSON.

const basisLabels: Record<Rationale['kind'], string> = {
  request: 'Условие заказчика',
  subject_reference: 'Учебный или предметный источник',
  research: 'Исследование',
  calculation: 'Расчёт',
  expert: 'Заключение специалиста',
  assumption: 'Предварительное предложение',
  gap: 'Объяснение пока не найдено',
};
const statusLabels: Record<Rationale['status'], string> = {
  unverified: 'ещё не проверено',
  partial: 'подтверждено лишь частично',
  confirmed: 'подтверждено в указанных пределах',
  expert_checked: 'проверено специалистом',
  pilot_checked: 'проверено на пробном обучении',
  stale: 'после изменений нужна повторная проверка',
};
const assessmentMaterialTypes: Material['type'][] = [
  'test',
  'project',
  'portfolio',
  'exam',
  'mentor_interview',
];

// Угловые скобки экранируются, чтобы фрагменты кода в материалах
// не превращались в HTML при просмотре.
const text = (value: string) =>
  formatDates(value.replace(/\r/g, '').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
const cell = (value: string) => text(value).replace(/\|/g, '&#124;').replace(/\n+/g, '<br>');
const table = (header: string[], rows: string[][], align: ('l' | 'r')[] = []) =>
  [
    `| ${header.map(cell).join(' | ')} |`,
    `|${header.map((_, i) => (align[i] === 'r' ? '---:' : '---')).join('|')}|`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
const list = (items: string[]) => items.map((item) => `- ${item}`).join('\n');
// Строки вида «Цель: …» в материалах и разделах выделяются как поля,
// строки с тире «– » — пункты списка.
const labelledLines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index, lines) => {
      if (line.startsWith('– ')) {
        const item = `- ${text(line.slice(2))}`;
        return index > 0 && !lines[index - 1].startsWith('– ') ? `\n${item}` : item;
      }
      const field = /^([^:.!?]{2,40}):\s+(.+)$/.exec(line);
      const paragraph = field ? `**${text(field[1])}:** ${text(field[2])}` : text(line);
      return index > 0 && lines[index - 1].startsWith('– ') ? `\n${paragraph}` : paragraph;
    })
    .join('  \n')
    .replace(/  \n(?=- |\n)/g, '\n');

export function courseMarkdown(snapshot: Snapshot): string {
  const s = snapshot.skeleton;
  const req = s.requirements;
  const signature = rationaleSignature(s);
  const elements = skeletonElements(s);
  const codes = outcomeCodes(s);
  const rows = curriculumRows(s);
  const kinds = usedHourKinds(s);
  const topicTitle = (id: string) => {
    const row = rows.find((r) => r.topic?.id === id);
    return row ? topicHeading(row) : 'Курс целиком';
  };
  const outcomeList = (ids: string[]) => ids.map((id) => codes[id] ?? id).join(', ');

  // Внутренние идентификаторы в текстах заменяются кодами и названиями,
  // которые методист видит в программе. Длинные идентификаторы идут первыми,
  // чтобы outcome-10 не заменился как outcome-1.
  const names = new Map(elements.map((e, i) => [e.id, `${e.title} (${i + 1})`]));
  for (const outcome of s.outcomes) names.set(outcome.id, codes[outcome.id]);
  for (const topic of s.topics) names.set(topic.id, `«${topic.title}»`);
  const readable = (value: string) => {
    let result = value;
    for (const [id, name] of [...names].sort((a, b) => b[0].length - a[0].length))
      result = result.replaceAll(id, name);
    return result
      .replaceAll('time_budgets', 'распределении времени по учебным действиям')
      .replaceAll(
        'Предложение демонстрационного проектировщика; необходимость требует предметной проверки.',
        'Это предложение из готового примера. Преподавателю нужно проверить, подходит ли оно группе.',
      )
      .replaceAll('Сохранено условие запроса.', 'Такое условие указано в запросе заказчика.');
  };

  const blocks: string[] = [];
  const add = (...items: (string | false | undefined)[]) =>
    blocks.push(...items.filter((item): item is string => !!item));

  const approved = approvedAtCreation(snapshot);
  add(
    `# ${req.title}`,
    `${programTypeName(req)}. Черновик комплекта, требует проверки методистом.`,
    `Версия курса: ${snapshot.course_version}. ${approved ? 'На момент сохранения план был утверждён.' : 'На момент сохранения план ещё не был утверждён.'} Сохранено ${text(snapshot.created_at.slice(0, 10))}.`,
    snapshot.mode === 'demo'
      ? 'План собран по заранее подготовленному примеру. Его нужно обсудить с преподавателем перед запуском; отметка об утверждении не означает независимую экспертизу.'
      : 'Описание составлено по сохранённым данным курса. Утверждение плана не заменяет проверку содержания и заданий специалистом.',
  );

  const sections = [
    'Перед утверждением: что проверить',
    'Для кого и зачем этот курс',
    'Чему научатся участники',
    'Как будет проходить обучение',
    'Как понять, что цель достигнута',
    'Когда и с какой нагрузкой заниматься',
    snapshot.materials.length && 'Материалы по темам',
    snapshot.sections.length && 'Разделы программы по шаблону',
    'Почему план устроен так',
    'Источники и их ограничения',
    'Подробные пояснения к решениям',
    'Сведения о сохранённой версии',
  ].filter((title): title is string => !!title);
  add('**Содержание**', sections.map((title, i) => `${i + 1}. ${title}`).join('\n'));

  const review = reviewItems(snapshot);
  add('## Перед утверждением: что проверить');
  add(
    review.length
      ? review
          .map((item) => `- [ ] **${text(item.title)}.** ${text(readable(item.detail))}`)
          .join('\n')
      : 'Открытых замечаний нет. Педагогическая экспертиза при этом не проводилась.',
  );
  if (snapshot.decisions.length)
    add(
      '### Принятые исключения',
      list(
        snapshot.decisions.map(
          (decision) =>
            `${text(decision.finding || decision.issue_id)}. Причина: ${text(decision.reason)}. Область: ${text(decision.scope || 'сохранённая версия')}; hash: ${decision.scope_hash || snapshot.skeleton_hash}. Решение не подтверждает соответствие требованию.`,
        ),
      ),
    );

  const totalByKind = rows.at(-1)!.hours;
  add(
    '## Для кого и зачем этот курс',
    table(
      ['Параметр', 'Значение'],
      [
        ['Участники', req.audience || 'Нужно уточнить'],
        ['Что нужно знать до начала', req.entry_level || 'Входной уровень пока не определён'],
        [
          'Объём',
          `${formatHours(req.total_hours || '0')} ч${kinds.length ? ` (${kinds.map((k) => `${hourLabels[k].toLowerCase()} ${formatHours(totalByKind[k])}`).join(', ')})` : ''}`,
        ],
        ['Формат', req.delivery || 'Нужно уточнить'],
        ['Итоговая аттестация', req.assessment || 'Способ проверки ещё не выбран'],
        ['Сроки', req.calendar.description || 'Расписание ещё нужно согласовать'],
      ],
    ),
    `**Цель:** ${text(s.goal || 'Нужно уточнить.')}`,
    s.tasks.length > 0 && `**Задачи:**\n${list(s.tasks.map(text))}`,
    req.constraints && `**Что нужно учесть:** ${text(req.constraints)}`,
  );
  const answered = contentQuestions(req).filter((q) => req.clarification_answers?.[q.id]);
  if (answered.length)
    add(
      '### Уточнения перед построением программы',
      list(
        answered.map(
          (q) =>
            `**${text(q.label)}** ${text(req.clarification_answers![q.id])}  \n${text(q.reason)}`,
        ),
      ),
    );

  add('## Чему научатся участники');
  add(
    s.outcomes.length
      ? table(
          ['Код', 'Тип', 'Результат обучения', 'Как проверяется'],
          s.outcomes.map((o) => [
            codes[o.id],
            kindLabels[o.kind],
            o.description,
            s.assessments
              .filter((a) => a.outcome_ids.includes(o.id))
              .map((a) => `${assessmentLabels[a.type]}: ${a.action}`)
              .join('\n') || 'Проверка ещё не назначена',
          ]),
        )
      : 'Результаты обучения ещё нужно сформулировать.',
  );

  add(
    '## Как будет проходить обучение',
    table(
      ['№', 'Модуль и тема', 'Всего, ч', ...kinds.map((k) => hourLabels[k]), 'Контроль'],
      rows.map((row) => {
        const bold = (value: string) => (row.level === 'topic' ? value : `**${value}**`);
        return [
          row.number,
          bold(row.level === 'module' ? moduleHeading(row) : row.title),
          bold(formatHours(row.total)),
          ...kinds.map((k) => formatHours(row.hours[k])),
          row.control,
        ];
      }),
      ['l', 'l', 'r', ...kinds.map(() => 'r' as const)],
    ),
    '### Содержание тем',
    list(
      rows
        .filter((row) => row.topic)
        .map(
          (row) =>
            `**${text(topicHeading(row))}** (${formatHours(row.total)} ч). ${text(row.topic!.content)}${row.topic!.outcome_ids.length ? ` Результаты: ${outcomeList(row.topic!.outcome_ids)}.` : ''}`,
        ),
    ),
  );
  if (s.activities.length)
    add(
      '### Что участники будут делать на практике',
      list(
        s.activities.map(
          (a) => `**${text(topicTitle(a.topic_id))}.** ${text(readable(a.description))}`,
        ),
      ),
    );

  add('## Как понять, что цель достигнута');
  for (const a of s.assessments)
    add(
      `### ${assessmentLabels[a.type]}: ${text(topicTitle(a.topic_id))}`,
      `${text(a.action)}  \n**Критерий успешной работы:** ${text(a.criterion)}  \n**Проверяет:** ${outcomeList(a.outcome_ids)}`,
    );
  if (!s.assessments.length) add('Оценочные средства ещё не назначены.');

  const calendar = req.calendar;
  add(
    '## Когда и с какой нагрузкой заниматься',
    text(calendar.description || 'Расписание ещё нужно согласовать.'),
    `Начало: ${calendar.start ? text(calendar.start) : 'дата не выбрана'}. Период: ${calendar.calendar_days || 'не определён'} календарных дней. Нагрузка за день: ${calendar.daily_limit ? `до ${formatHours(calendar.daily_limit)} ч` : 'нужно уточнить'}. ${calendar.confirmed ? 'Условия календаря подтверждены в запросе.' : 'Условия календаря пока не подтверждены.'}`,
  );
  if (s.sessions?.length)
    add(
      '### Расписание занятий',
      table(
        ['Дата', 'Тема', 'Виды работы'],
        s.sessions.map((session) => [
          session.date,
          topicTitle(session.topic_id),
          hourKinds
            .filter((k) => Number(session.hours[k]) > 0)
            .map((k) => `${hourLabels[k]} ${formatHours(session.hours[k])} ч`)
            .join(', '),
        ]),
      ),
      'Итоговая аттестация включена в расписание один раз.',
    );
  else add('Вместимость проверена; расписание не составлено. Назначьте даты занятий.');
  if (s.conflicts.length) {
    add('### Что мешает выполнить план');
    const decisionLabels: Record<string, string> = {
      extend: 'увеличить срок обучения',
      raise: 'увеличить дневную нагрузку',
      reduce: 'сократить объём курса',
    };
    for (const conflict of s.conflicts)
      add(
        `**${conflict.status === 'resolved' ? 'Решение принято' : 'Нужно принять решение'}.** ${[conflict.expected, conflict.actual, conflict.calculation].map((part) => text(part.replace(/\.$/, ''))).join('. ')}.`,
        conflict.decision
          ? `Выбранный вариант: ${text(conflict.options.find((o) => o.id === conflict.decision?.option_id)?.title || decisionLabels[conflict.decision.option_id] || 'решение записано в сохранённой версии')}.`
          : list(conflict.options.map((o) => `${text(o.title)}: ${text(o.consequence)}`)),
      );
  }

  if (snapshot.materials.length) {
    add(
      '## Материалы по темам',
      'Материалы сгруппированы по темам учебного плана. Ключи тестов и заметки для преподавателя предназначены только методисту и преподавателю.',
    );
    // Тесты и проекты проверяют результаты курса целиком, поэтому идут
    // отдельной группой после материалов тем, даже если привязаны к теме.
    const assessed = snapshot.materials.filter((m) => assessmentMaterialTypes.includes(m.type));
    for (const row of rows.filter((r) => r.topic)) {
      const materials = snapshot.materials.filter(
        (m) => m.topic_id === row.topic!.id && !assessed.includes(m),
      );
      if (!materials.length) continue;
      add(`### ${text(topicHeading(row))}`);
      for (const material of materials) add(...materialBlocks(material));
    }
    if (assessed.length) {
      add('### Оценочные материалы');
      for (const material of assessed) add(...materialBlocks(material));
    }
    const unplaced = snapshot.materials.filter(
      (m) => !assessed.includes(m) && !rows.some((r) => r.topic?.id === m.topic_id),
    );
    if (unplaced.length) {
      add('### Другие материалы курса');
      for (const material of unplaced) add(...materialBlocks(material));
    }
  }

  if (snapshot.sections.length) {
    add(
      '## Разделы программы по шаблону',
      'Тексты разделов для документа по шаблону АЦР. Таблицы учебного плана, результатов и расписания приведены выше.',
    );
    for (const section of snapshot.sections) {
      const kind = sectionTable(section.title);
      const pointer = {
        curriculum: 'Учебный план — в разделе «Как будет проходить обучение».',
        outcomes: 'Результаты обучения — в разделе «Чему научатся участники».',
        working_programs: 'Рабочие программы тем — в разделе «Материалы по темам».',
        calendar: '',
        hours: '',
      };
      const skipped =
        kind === 'calendar' || kind === 'hours' ? replacedSectionField[kind] : undefined;
      const fields = (section.fields ?? [{ label: 'Содержание', value: section.content }]).filter(
        (field) => field.label !== skipped,
      );
      add(`### ${text(section.title)}`);
      if (kind && pointer[kind]) add(pointer[kind]);
      else
        add(
          fields
            .map(
              (field) =>
                `**${text(field.label)}:** ${field.value.trim() ? labelledLines(readable(field.value)) : '____ (заполняет методист)'}`,
            )
            .join('  \n'),
        );
    }
  }

  add('## Почему план устроен так');
  for (const explanation of s.explanations)
    add(
      `### ${text(explanation.title)}`,
      text(readable(explanation.conclusion)),
      text(readable(explanation.detail)),
      `**Что ещё проверить:** ${text(explanation.missing || 'Дополнительные вопросы не указаны.')}`,
    );
  const coverage = rationaleCoverage(s);
  add(
    '### Что уже известно, а что требует проверки',
    'Условия заказчика подтверждают, какой курс он хочет получить. Расчёты подтверждают сумму часов. Достаточно ли этого времени для конкретной группы, должны оценить преподаватель и пробный запуск.',
    table(
      ['Основания решений', 'Элементов'],
      [
        ['Подтверждено запросом, расчётом или проверенным источником', String(coverage.confirmed)],
        ['Проверено специалистом или на пробном обучении', String(coverage.expert)],
        ['Пока остаётся предположением', String(coverage.assumptions)],
        ['Объяснение неполное, отсутствует или требует обновления', String(coverage.gaps)],
        ['Всего', String(elements.length)],
      ],
      ['l', 'r'],
    ),
    'Каждый элемент учтён один раз. Эти числа описывают основания решений, а не качество курса.',
    '### Результаты автоматической проверки',
    list(
      snapshot.audit.checks.map(
        (check) =>
          `${{ passed: '✓', failed: '✗', not_run: '○' }[check.status]} **${text(check.title)}:** ${{ passed: 'пройдена', failed: 'найдена проблема', not_run: 'не проводилась' }[check.status]}. ${text(readable(check.actual))}`,
      ),
    ),
    'Педагогическая проверка специалистом пока не проведена. Автоматические проверки структуры не подтверждают качество обучения.',
  );

  add(
    '## Источники и их ограничения',
    'Ссылка сама по себе не подтверждает решение. Важно, какой текст прочитан и относится ли он к этой аудитории и задаче.',
  );
  const sources = [...req.references, ...(s.rationale_sources || [])];
  const unconfirmed = new Set(unconfirmedSources(snapshot).map((source) => source.id));
  for (const source of sources) {
    const p = source.provenance;
    add(
      `### ${unconfirmed.has(source.id) ? '[НЕ ПОДТВЕРЖДЁН] ' : ''}${text(source.name)}`,
      [
        source.url && `[Открыть источник](${source.url})`,
        (p?.authors || p?.year) && text([p.authors, p.year].filter(Boolean).join(', ')),
        `**Что известно:** ${text(p?.result || source.claim || 'Связь с решениями курса ещё нужно проверить.')}`,
        `**Что прочитано:** ${p ? { none: 'текст не прочитан', excerpt: 'отдельный фрагмент', abstract: 'аннотация', full_text: 'полный текст' }[p.extent] : 'нет сведений'}. ${p?.content === 'confirmed' ? 'Содержание подтверждено в сохранённых данных.' : 'Содержание ещё не подтверждено.'}`,
        p?.population && `**Кого изучали:** ${text(p.population)}`,
        source.text && `**Сохранённый фрагмент:** ${text(source.text)}`,
        source.scope && `**Границы применения:** ${text(source.scope)}`,
      ]
        .filter(Boolean)
        .join('  \n'),
    );
  }
  if (!sources.length)
    add('Источники пока не добавлены. Основание не найдено; требуется проверка.');

  add(
    '## Подробные пояснения к решениям',
    'Справочный раздел для обсуждения плана: по каждому элементу показано, на чём основано решение и что осталось проверить.',
  );
  for (const [i, element] of elements.entries()) {
    let decision = readable(element.decision);
    const topic = s.topics.find((t) => `hours:${t.id}` === element.id);
    if (topic) {
      decision = `${formatHours(topic.planned_total)} ч: ${hourKinds
        .filter((kind) => Number(topic.hours[kind]) > 0)
        .map((kind) => `${hourLabels[kind].toLowerCase()} — ${formatHours(topic.hours[kind])} ч`)
        .join('; ')}.`;
      const budget = s.time_budgets?.find((b) => b.topic_id === topic.id);
      if (budget) decision += ` ${budget.note}`;
    }
    if (element.id === 'calendar')
      decision = req.calendar.description || 'Расписание нужно согласовать.';
    const conflict = s.conflicts.find((c) => c.id === element.id);
    if (conflict) decision = `${conflict.expected}. ${conflict.actual}. ${conflict.calculation}`;
    const title = element.title.replace(
      /Оценочное средство: (\w+)/,
      (_, type: keyof typeof assessmentLabels) => `Проверка: ${assessmentLabels[type] || type}`,
    );
    add(`### ${i + 1}. ${text(title)}`, text(decision));
    const records = currentRationales(s, element.id, signature);
    if (!records.length) add(missingBasis);
    for (const record of records) {
      const source = sourceById(s, record.source_id);
      add(
        [
          `**${basisLabels[record.kind]}, ${statusLabels[record.status]}.**`,
          list(
            [
              `Почему предложено: ${readable(record.purpose)}`,
              `На что опираемся: ${record.source_id === 'request' ? 'сохранённый запрос заказчика.' : source?.name || 'подтверждающий источник пока не указан.'}`,
              record.fragment && `Фрагмент основания: ${record.fragment}`,
              `Что это подтверждает: ${readable(record.applicability)}`,
              `Другие варианты: ${readable(record.alternatives)}`,
              `Ограничения: ${record.trust} ${record.limitations}`,
              `Что проверено: ${record.verification}${record.reviewer ? ` Проверял: ${record.reviewer}, ${record.checked_at || 'дата не указана'}.` : ''}`,
              `Следующий шаг: ${record.next_check}`,
              !rationaleIsSupported(s, record, signature) &&
                'Этого основания пока недостаточно, чтобы считать решение подтверждённым.',
            ]
              .filter((item): item is string => !!item)
              .map(text),
          ),
        ].join('\n'),
      );
    }
  }

  add(
    '## Сведения о сохранённой версии',
    snapshot.mode === 'demo'
      ? 'Использован заранее подготовленный сценарий без генерации моделью. Поиск и чтение внешних файлов, независимая экспертиза и пробное обучение не выполнялись.'
      : 'Описание использует только выбранную сохранённую версию с сервера.',
    'Если меняются аудитория, результаты, часы или источники, прежние пояснения нужно пересмотреть. Описание старой версии продолжает отражать её сохранённые данные.',
    list([
      `Курс: ${snapshot.course_id}`,
      `Версия курса: ${snapshot.course_version}; версия плана: ${snapshot.skeleton_version}`,
      `Сохранено: ${snapshot.created_at}`,
      `SHA-256 структуры программы: ${snapshot.skeleton_hash}`,
    ]),
    'Контрольная сумма позволяет сопоставить это описание с JSON-выгрузкой той же версии.',
    '### Указатели для сверки оснований',
    elements
      .map((element, i) => {
        const records = currentRationales(s, element.id, signature);
        return `- Пункт ${i + 1}: ${element.id}${records.length ? `; основания: ${records.map((r) => `${r.id} (версия ${r.version}, источник: ${r.source_id || 'не указан'}${r.coordinate ? `, место: ${r.coordinate}` : ''})`).join('; ')}` : ''}.`;
      })
      .join('\n'),
    sources.length > 0 &&
      `### Сведения об источниках для сверки\n${list(
        sources.map(
          (source) =>
            `${source.id}: ${text(source.name)}; контрольная сумма: ${source.hash || 'не указана'}; место в источнике: ${source.coordinate || 'не указано'}; DOI: ${source.provenance?.doi || 'не указан'}`,
        ),
      )}`,
    ...s.conflicts
      .filter((conflict) => conflict.decision)
      .map(
        (conflict) =>
          `Изменение календаря ${conflict.id}. До: ${conflict.decision!.before}. После: ${conflict.decision!.after}.`,
      ),
  );
  return blocks.join('\n\n') + '\n';

  function materialBlocks(material: Material): string[] {
    const result = [`#### ${text(material.title)}`];
    if (material.content.trim()) result.push(labelledLines(readable(material.content)));
    if (material.expected)
      result.push(`**Ожидаемый результат:** ${text(readable(material.expected))}`);
    if (material.criteria.length)
      result.push(`**Критерии оценки:**\n${list(material.criteria.map((c) => text(readable(c))))}`);
    if (material.questions.length) {
      result.push(
        `**Вопросов:** ${material.questions.length}${material.test_policy ? `; тест сдан при ${material.test_policy.pass_count} верных ответах` : ''}.`,
      );
      for (const [index, question] of material.questions.entries())
        result.push(
          [
            `**Вопрос ${index + 1}.** ${text(question.text)}`,
            ...question.options.map((option, i) => `${i + 1}. ${text(option)}`),
            '',
            `Ключ: ${question.correct_index + 1}. ${text(question.explanation)}  \nПроверяет: ${outcomeList(question.outcome_ids)}`,
          ].join('\n'),
        );
    }
    for (const [index, slide] of material.slides.entries())
      result.push(
        [
          `**Слайд ${index + 1}. ${text(slide.title)}**`,
          list(slide.bullets.map((bullet) => text(bullet))),
          slide.notes && `\n*Заметки преподавателя:* ${text(slide.notes)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    for (const dataset of material.datasets || [])
      result.push(
        `**Данные: ${text(dataset.name)}.** ${text(dataset.description)}`,
        table(
          dataset.columns,
          dataset.rows.map((row) => row.map((value) => String(value ?? 'NULL'))),
        ),
      );
    if (material.manual) result.push('*Материал изменён вручную.*');
    return result;
  }
}
