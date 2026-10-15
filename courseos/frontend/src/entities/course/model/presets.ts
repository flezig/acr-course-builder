import { professionalStandardReferences } from './professional-standards';
import type { Requirements } from './schema';
export const emptyRequirements: Requirements = {
  request: '',
  title: '',
  template_id: 'unknown',
  audience: '',
  entry_level: '',
  goal: '',
  total_hours: '',
  delivery: '',
  assessment: '',
  constraints: '',
  calendar: {
    description: '',
    start: '',
    calendar_days: 0,
    weekdays_only: false,
    daily_limit: '',
    confirmed: false,
    same_units: true,
  },
  references: [],
};
// Образец структуры для запроса 5: учебный план стажировки «Бизнес и системный анализ» (248 ч).
// Строки записаны в том виде, в каком их сверяет агент; итог образца намеренно не сходится с разделом.
const internshipSample: Requirements['references'][number] = {
  id: 'sample-internship-ba',
  name: 'Образец АЦР: стажировка «Бизнес и системный анализ»',
  text: 'Учебный план образца, 248 ч. Раздел 1 «Бизнес и системный анализ»: всего 246, ЛК 0, ПР 0, ЛБ 0, СРС 246. Итоговая аттестация: 2 ч, зачёт. Итого: 248, ЛК 0, ПР 66, ЛБ 6, СРС 174.',
  url: '',
  status: 'provided',
  coordinate: 'Раздел 2.1 «Учебный план»',
  claim: 'Структура разделов стажировки; содержание и итоговая строка не переносятся.',
  checked_at: '2026-10-15',
  scope: 'Приложение к запросу: используется только как образец структуры.',
  hash: '',
};
const preset = (changes: Partial<Requirements>): Requirements => ({
  ...structuredClone(emptyRequirements),
  ...changes,
});
export const presets: {
  id: string;
  label: string;
  description: string;
  requirements: Requirements;
}[] = [
  {
    id: 'python',
    label: 'Первые шаги в Python',
    description: '16 часов · школьники · общеразвивающая',
    requirements: preset({
      request:
        'Python для школьников 8–9 классов без опыта. 16 часов, очно, 8 занятий по 2 часа дважды в неделю. Практика не менее 8 часов. Проект: игра или чат-бот. Итоговый тест10, слайды занятий1–2.',
      title: 'Первые шаги в Python',
      template_id: 'acr_general',
      audience: 'Школьники 8–9 классов',
      entry_level: 'Без опыта программирования',
      goal: 'Создать простую программу с переменными, условиями и циклами',
      total_hours: '16',
      delivery: 'Очно',
      assessment: 'Защита проекта',
      constraints: 'Практики минимум 8 часов; 10 вопросов; слайды занятий 1–2',
      calendar: {
        description: '8 занятий по 2 часа, дважды в неделю, 4 недели',
        start: '2026-10-14',
        calendar_days: 28,
        weekdays_only: false,
        daily_limit: '2',
        confirmed: true,
        same_units: true,
      },
    }),
  },
  {
    id: 'teachers',
    label: 'ИИ в работе учителя',
    description: '36 часов · учителя · повышение квалификации',
    requirements: preset({
      request:
        'ИИ для учителей школ Ингушетии. 36 часов, очно-заочно с ДОТ. Без программирования. Планы уроков, задания, проверочные работы; риски и данные детей. Портфолио из трёх материалов. Только доступные в России сервисы.',
      title: 'Искусственный интеллект в работе учителя',
      references: professionalStandardReferences('teachers'),
      template_id: 'acr_professional',
      audience: 'Учителя школ Ингушетии',
      entry_level: 'Без навыков программирования',
      total_hours: '36',
      delivery: 'Очно-заочно с ДОТ',
      goal: 'Подготовить и проверить учебные материалы с помощью ИИ',
      assessment: 'Зачёт по портфолио из трёх материалов',
      constraints:
        'Без персональных данных детей. Доступность сервисов и профстандарт Педагог требуют проверки.',
    }),
  },
  {
    id: 'bank',
    label: 'Анализ данных на Python',
    description: '72 часа · сотрудники банков · повышение квалификации',
    requirements: preset({
      request:
        'Анализ данных на Python для сотрудников банков с опытом Excel. 72 часа, очно-заочно, четыре недели. Python, pandas, визуализация, SQL, статистика. Проект на обезличенных данных; слайды всех лекций pandas.',
      title: 'Анализ данных на Python',
      references: professionalStandardReferences('bank'),
      template_id: 'acr_professional',
      audience: 'Сотрудники региональных отделений банков',
      entry_level: 'Опыт работы в Excel',
      total_hours: '72',
      delivery: 'Очно-заочно',
      goal: 'Сотрудник отделения самостоятельно выгружает данные по клиентам и кредитам, очищает их и готовит для руководителя отчёт с выводами — без помощи аналитика',
      assessment: 'Защита проекта на обезличенных банковских данных',
      constraints:
        'Новое содержание; прошлую программу использовать только как структуру. Подтвердить профстандарт и актуальность инструментов.',
      calendar: {
        description: '4 недели; учебные дни и дневная нагрузка в запросе не указаны',
        start: '2026-10-14',
        calendar_days: 28,
        weekdays_only: false,
        daily_limit: '',
        confirmed: false,
        same_units: true,
      },
    }),
  },
  {
    id: 'security',
    label: 'Кибербезопасность',
    description: 'Неполный запрос · пять уточнений',
    requirements: preset({
      request:
        'Сделайте курс по кибербезопасности для студентов колледжа, примерно на месяц, чтобы после него ребята могли пойти работать в эту сферу.',
      title: 'Кибербезопасность для колледжа',
      references: professionalStandardReferences('security'),
      audience: 'Студенты колледжа',
      goal: 'Освоить начальные действия на учебном стенде; трудоустройство не гарантируется',
      constraints: 'Учесть параллельное получение СПО; профстандарт ИБ требует подтверждения.',
    }),
  },
  {
    id: 'devops',
    label: 'DevOps: Linux → CI/CD',
    description: '256 часов · стажировка · календарный конфликт',
    requirements: preset({
      request:
        'DevOps-стажировка 256 часов: 254 СРС + 2 аттестация; контактных занятий нет. Под наставником в ИТ-компаниях, около двух месяцев, до 4 часов в день. Защита отчёта.',
      title: 'DevOps-инженер от Linux до CI/CD',
      template_id: 'acr_professional',
      audience: 'Стажёры ИТ-компаний региона',
      entry_level: 'Базовые навыки работы с компьютером; глубина требует проверки наставником',
      goal: 'Выполнить базовый цикл развёртывания и сопровождения учебного сервиса',
      total_hours: '256',
      delivery: 'Стажировка под руководством наставника',
      assessment: 'Защита отчёта о стажировке',
      constraints:
        '254 часа СРС + 2 аттестации. Лекции, практика и лабораторные — 0. Максимум 4 часа в день.',
      references: [internshipSample, ...professionalStandardReferences('devops')],
      calendar: {
        description:
          'Около двух месяцев — уточните даты. Для demo предлагаются 8 недель с ежедневной работой.',
        start: '2026-10-14',
        calendar_days: 56,
        weekdays_only: false,
        daily_limit: '4',
        confirmed: false,
        same_units: true,
      },
    }),
  },
];
export const kindLabels = { knowledge: 'Знания', skill: 'Умения', proficiency: 'Навыки' };
export const assessmentLabels = {
  test: 'Тест',
  practical: 'Практическое задание',
  project: 'Проект',
  portfolio: 'Портфолио',
  exam: 'Экзамен',
  mentor_interview: 'Собеседование с наставником',
};
export const materialLabels = {
  working_program: 'Рабочая программа',
  test: 'Тест с ключами',
  seminar: 'Семинар',
  lecture: 'Лекция и слайды',
  project: 'Проект',
  portfolio: 'Портфолио',
  exam: 'Экзамен',
  mentor_interview: 'Собеседование с наставником',
};
