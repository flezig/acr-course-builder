import type { Requirements, Skeleton } from './schema';
import { rationaleSignature } from './rationale';
// Curated excerpts are paraphrases with coordinates, not a simulated source search.
// These sources guide the new demo design; they do not validate subject facts or hours.
export const methodologySources: Requirements['references'] = [
  {
    id: 'research-biggs-1996',
    name: 'Конструктивное согласование',
    text: 'Согласовать наблюдаемые действия в целях, учебной работе и оценивании.',
    url: 'https://link.springer.com/article/10.1007/BF00138871',
    status: 'retrieved',
    coordinate: 'Abstract, абзацы 2–4 (пересказ)',
    claim: 'Принцип согласования; не доказательство выбранных часов.',
    checked_at: '2026-10-15',
    scope: 'Прочитана аннотация; доступ к полному тексту не подтверждён.',
    hash: '30b273d5651c530cd67c274770eec8271762a2fe8127810e1b67ad987c0b5659',
    provenance: {
      origin: 'research',
      access: 'read',
      content: 'confirmed',
      extent: 'abstract',
      authors: 'John Biggs',
      year: '1996',
      title: 'Enhancing teaching through constructive alignment',
      doi: '10.1007/BF00138871',
      study_type: 'Концептуальная методическая статья с примером',
      population:
        'Повышение квалификации преподавателей, педагогическая психология; высшее образование',
      result:
        'Предлагается согласовывать цели, учебные действия и оценивание; часы школьного Python не исследовались.',
    },
  },
  {
    id: 'method-ubd-2014',
    name: 'Обратное проектирование UbD',
    text: 'Сначала определить результат и приемлемые свидетельства освоения, затем планировать обучение.',
    url: 'https://files.ascd.org/staticfiles/ascd/pdf/siteASCD/publications/ASCD_UBD_whitepaper.pdf',
    status: 'retrieved',
    coordinate: 'Stage 1–3; особенно Stage 2, печатная стр. 5 (пересказ)',
    claim: 'Порядок проектирования, не экспериментальная гарантия.',
    checked_at: '2026-10-15',
    scope: 'Доступен полный методический документ авторов; не научный эксперимент.',
    hash: 'bcceace11b6b4ba2afda8b7b33be42fef260d52c815b1188901cca1bb7627dcd',
    provenance: {
      origin: 'research',
      access: 'read',
      content: 'confirmed',
      extent: 'full_text',
      authors: 'Jay McTighe; Grant Wiggins',
      year: '2014',
      title:
        'Improve Curriculum, Assessment, and Instruction Using the Understanding by Design Framework',
      doi: '',
      study_type: 'Методическое руководство авторов, без экспериментальной выборки',
      population: 'Общее проектирование программ; экспериментальной аудитории нет',
      result:
        'Результаты → свидетельства освоения → учебный план. Не задаёт фиксированного количества средств или часов.',
    },
  },
  {
    id: 'research-subgoals-2020',
    name: 'Примеры с подцелями для начинающих',
    text: 'В семестровом вводном курсе у 265 студентов поддержка подцелями улучшила ближайшие проверки; средний результат экзамена статистически не улучшился.',
    url: 'https://link.springer.com/article/10.1186/s40594-020-00222-7',
    status: 'retrieved',
    coordinate: 'Abstract: Results; Methods; Subgoal labeled worked examples (пересказ)',
    claim: 'Мотивирует явные шаги примера, не длительности.',
    checked_at: '2026-10-15',
    scope:
      'Полный текст доступен; перенос с вузовского семестрового Java на школьные 16 часов Python не проверен.',
    hash: 'e940ce0030d453b79d79ae2605ce3682256ade592ad8dde0732d1b078a05c5c8',
    provenance: {
      origin: 'research',
      access: 'read',
      content: 'confirmed',
      extent: 'full_text',
      authors: 'Lauren E. Margulieux; Briana B. Morrison; Adrienne Decker',
      year: '2020',
      title:
        'Reducing withdrawal and failure rates in introductory programming with subgoal labeled worked examples',
      doi: '10.1186/s40594-020-00222-7',
      study_type: 'Сравнение учебных групп в семестровом вводном курсе',
      population: '265 студентов вводного курса программирования в вузе; Java',
      result:
        'Лучше ближайшие quiz; меньше неуспевших/выбывших; среднего улучшения экзамена не выявлено.',
    },
  },
];
export function addMethodologyRationales(s: Skeleton, python: boolean) {
  s.rationale_sources = structuredClone(
    methodologySources.filter((source) => python || source.id !== 'research-subgoals-2020'),
  );
  // Called after sources are installed and before the initial version is saved.
  const signature = rationaleSignature(s);
  for (const r of s.rationales || []) r.input_signature = signature;
  for (const stage of s.design_stages || [])
    if (stage.id !== 'analysis') stage.input_signature = signature;
  for (const e of [...s.outcomes, ...s.activities, ...s.assessments]) {
    const source =
      methodologySources[
        e.id.startsWith('activity') && python ? 2 : e.id.startsWith('assessment') ? 1 : 0
      ];
    const base = s.rationales?.find((r) => r.element_id === e.id);
    if (!base) continue;
    s.rationales!.push({
      ...base,
      id: `${base.id}:method`,
      kind: 'research',
      source_id: source.id,
      fragment: source.text,
      coordinate: source.coordinate,
      status: 'partial',
      applicability: `Поддерживает выбор ${e.id.startsWith('activity') ? 'примера с явными шагами перед самостоятельным выполнением' : 'наблюдаемого действия и связанного способа его проверки'} для начинающих. Конкретные содержание, глубина и длительность не подтверждены.`,
      alternatives:
        'Самостоятельный поиск решения без примера; эксперт должен сравнить нагрузку и доступную помощь.',
      trust:
        'Первичная публикация авторов; основание ограничено прочитанным объёмом и фактическим дизайном исследования, а не репутацией издателя.',
      limitations: source.scope,
      verification:
        'Проверено содержание указанного фрагмента; применимость к этой аудитории частичная. Экспертиза и пилот не проводились.',
      phase: 'design',
      input_signature: signature,
    });
  }
}
