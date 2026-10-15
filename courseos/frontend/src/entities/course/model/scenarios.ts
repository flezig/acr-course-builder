import type { ModuleDesign } from './hours-plan';
import { moduleProfiles } from './hours-plan';
import type { Requirements } from './schema';

export type ScenarioKind = 'devops' | 'bank' | 'teachers' | 'security' | 'python' | 'generic';

// Тема учебного плана вместе с решением по часам. Номера модулей, результатов и тем — с единицы,
// как в учебном плане АЦР.
export type ScenarioTopic = ModuleDesign & {
  module: number;
  content: string;
  control: string;
  outcomes: number[];
  prerequisites: number[];
  dependency?: string;
};

const pythonPractice =
  '0,5 ч показа и 1,5 ч практики: школьники без опыта закрепляют навык только руками, а практики по запросу не меньше половины.';

export const pythonTopics: ScenarioTopic[] = [
  ['Знакомство с Python', 1, [1], [], ''],
  [
    'Переменные и типы',
    1,
    [1],
    [1],
    'Переменные вводятся после первого запуска: школьник уже знает, где писать код и как увидеть результат.',
  ],
  [
    'Условия и выбор',
    1,
    [2],
    [2],
    'Условие сравнивает значения переменных, поэтому идёт после них.',
  ],
  [
    'Циклы и повторение',
    1,
    [3],
    [2, 3],
    'Цикл повторяет ход до условия выхода: нужны и переменные, и условия.',
  ],
  ['Строки и ввод', 2, [3], [2], 'Ввод игрока сохраняется в переменную-строку.'],
  ['Функции и разбиение задачи', 2, [3], [2], 'Функция получает и возвращает значения переменных.'],
  [
    'Сборка проекта',
    2,
    [3],
    [3, 4, 5, 6],
    'Проект собирает ввод, выбор, цикл и функции: сложные приёмы появляются только после базовых.',
  ],
].map(([title, module, outcomes, prerequisites, dependency], index) => ({
  title: title as string,
  module: module as number,
  weight: 2,
  split:
    index === 0
      ? { lecture: 1, practice: 1, self_study: 0 }
      : { lecture: 1, practice: 3, self_study: 0 },
  reason:
    index === 0
      ? 'Первое занятие: 1 ч на знакомство со средой и показ, 1 ч — первый запуск своей программы.'
      : pythonPractice,
  content: `Объяснение темы «${(title as string).toLowerCase()}» с примером, выполнение учебной задачи, разбор ошибок.`,
  control: 'Тест + практическая защита',
  outcomes: outcomes as number[],
  prerequisites: prerequisites as number[],
  dependency: (dependency as string) || undefined,
}));

const chain = (
  titles: [string, number, keyof typeof moduleProfiles, string][],
  control: string,
  dependency: (previous: string, current: string) => string,
): ScenarioTopic[] =>
  titles.map(([title, weight, profile, reason], index) => ({
    title,
    module: index + 1,
    weight,
    split: moduleProfiles[profile],
    reason,
    content: `Объяснение темы «${title.toLowerCase()}» на примере, выполнение учебной задачи с обратной связью, проверка результата.`,
    control,
    outcomes: [index + 1],
    prerequisites: index ? [index] : [],
    dependency: index ? dependency(titles[index - 1][0], title) : undefined,
  }));

export const devopsTopics = chain(
  [
    [
      'Linux и командная строка',
      48,
      'tool',
      '48 ч: основа всех следующих разделов — без уверенной работы в терминале стажёр не продвинется дальше.',
    ],
    [
      'Сети и диагностика',
      36,
      'tool',
      '36 ч: диагностика нужна для контейнеров и мониторинга, но глубокая сетевая инженерия вне цели стажировки.',
    ],
    [
      'Контейнеризация',
      44,
      'tool',
      '44 ч: учебный сервис упаковывается в контейнер — это центральный артефакт отчёта.',
    ],
    [
      'CI/CD',
      48,
      'tool',
      '48 ч: конвейер сборки и выкладки — главный результат из названия стажировки.',
    ],
    ['Мониторинг', 36, 'tool', '36 ч: метрики и оповещения для уже развёрнутого сервиса.'],
    [
      'Инфраструктура как код',
      42,
      'tool',
      '42 ч: описание окружения кодом завершает цикл и требует всех предыдущих навыков.',
    ],
  ],
  'Собеседование + отчёт',
  (previous, current) =>
    `«${current}» выполняется на сервисе, подготовленном в разделе «${previous}».`,
);

export const teacherTopics = chain(
  [
    [
      'Риски, этика и данные детей',
      6,
      'intro',
      'Вводный модуль: правила безопасной работы объясняются до первых запросов к сервисам.',
    ],
    [
      'Запрос и проверка ответа ИИ',
      8,
      'tool',
      'Самый весомый модуль: умение проверить ответ нужно во всех следующих материалах.',
    ],
    ['План урока', 7, 'tool', 'Первый материал портфолио: практика на плане своего урока.'],
    ['Задания для учеников', 7, 'tool', 'Второй материал портфолио: практика на своём классе.'],
    [
      'Проверочная работа',
      6,
      'tool',
      'Третий материал портфолио; приёмы проверки ответа уже освоены, теории меньше.',
    ],
  ],
  'Практическое задание',
  (previous, current) => `«${current}» использует приёмы из модуля «${previous}».`,
);

export const securityTopics = chain(
  [
    [
      'Сети и модель угроз',
      14,
      'intro',
      'Вводный модуль: понятия угроз объясняются до работы на стенде.',
    ],
    [
      'Linux и права доступа',
      14,
      'tool',
      'Слушатели знают основы Linux: упор на практику прав доступа.',
    ],
    ['Журналы и диагностика', 14, 'tool', 'Практика поиска событий в журналах учебного стенда.'],
    [
      'Защита учебного стенда',
      16,
      'tool',
      'Самый весомый модуль: настройка защиты — основа экзамена.',
    ],
    ['Разбор инцидента', 12, 'project', 'Сквозная задача на стенде перед экзаменом.'],
  ],
  'Практическое задание на стенде',
  (previous, current) => `«${current}» опирается на навыки модуля «${previous}».`,
);

export function genericTopics(requirements: Requirements): ScenarioTopic[] {
  const count = Math.max(3, Math.min(32, Math.ceil(Number(requirements.total_hours) / 16)));
  return Array.from({ length: count }, (_, index) => {
    const title = `${index + 1}. ${['Основы', 'Разбор примера', 'Применение', 'Диагностика', 'Практикум', 'Самостоятельная задача'][index % 6]}: ${requirements.title}`;
    return {
      title,
      module: index + 1,
      weight: 1,
      split: moduleProfiles[index === 0 ? 'intro' : 'tool'],
      reason:
        'Оценка, не проверено: темы делят объём поровну — сведений о сложности тем в запросе нет.',
      content: `Объяснение темы «${title.toLowerCase()}», выполнение учебной задачи, обратная связь и проверка результата.`,
      control: 'Тест + практическая защита',
      outcomes: [index + 1],
      prerequisites: [],
    };
  });
}

export const finalHoursReason: Record<ScenarioKind, string> = {
  python: 'Восьмое занятие — защита проекта, 2 ч.',
  devops: 'По запросу: 2 ч итоговой аттестации.',
  bank: 'Защита проекта, 2 ч: оценка, не проверено — длительность зависит от числа слушателей в группе.',
  teachers:
    'Зачёт по портфолио, 2 ч: оценка, не проверено — длительность зависит от числа слушателей в группе.',
  security:
    'Экзамен на стенде, 2 ч: оценка, не проверено — длительность практического задания уточняет методист.',
  generic: 'Итоговая аттестация, 2 ч: оценка, не проверено.',
};
