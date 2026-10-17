import type { ClarifyingQuestion, Requirements } from './schema';

// У заготовленных вопросов примеров ответ напрямую меняет конкретную тему,
// а ответы на вопросы модели она сама учитывает при проектировании каркаса.
export type DemoClarification = ClarifyingQuestion & {
  topic: number;
  practice: string;
};

// Вопросы для пяти примеров; для своего запроса их формирует модель (model_questions).
export const demoClarifications: Record<string, DemoClarification[]> = {
  python: [
    {
      id: 'project',
      label: 'Итоговый проект: игра или чат-бот?',
      options: ['Текстовая игра', 'Чат-бот'],
      recommended: 'Текстовая игра',
      reason: 'В запросе есть и игра, и чат-бот: от выбора зависят задания второй половины курса.',
      topic: 7,
      practice:
        'Собрать итоговый проект, связать ввод, условия и цикл; проверить основные сценарии и выход.',
    },
    {
      id: 'environment',
      label: 'Где школьники будут запускать Python?',
      options: ['На своих компьютерах с Python', 'В онлайн-среде'],
      recommended: 'В онлайн-среде',
      reason:
        'Среда работы определяет, нужно ли время на установку и настройку перед первым заданием.',
      topic: 1,
      practice: 'Подготовить выбранную среду, открыть первый скрипт и проверить его запуск.',
    },
  ],
  teachers: [
    {
      id: 'portfolio',
      label: 'Для каких классов готовим материалы портфолио?',
      options: ['Начальная школа', '5–9 классы', '10–11 классы'],
      recommended: '5–9 классы',
      reason:
        'Возраст учеников определяет сложность заданий и способы проверки трёх материалов портфолио.',
      topic: 5,
      practice: 'Подготовить и проверить три материала портфолио с учётом возраста учеников.',
    },
  ],
  bank: [
    {
      id: 'project',
      label: 'Какую банковскую задачу взять для проекта?',
      options: ['Просрочка по кредитам', 'Отток клиентов'],
      recommended: 'Просрочка по кредитам',
      reason:
        'В запросе указан проект на обезличенных данных: выбранная задача определит показатели и выводы отчёта.',
      topic: 5,
      practice:
        'Выбрать показатели для выбранной задачи, построить графики и подготовить выводы для руководителя.',
    },
  ],
  security: [
    {
      id: 'focus',
      label: 'Какое начальное рабочее действие важнее освоить?',
      options: ['Разбор журналов событий', 'Настройка защиты компьютера', 'Проверка учебной сети'],
      recommended: 'Разбор журналов событий',
      reason:
        'Запрос говорит о работе в сфере безопасности без конкретной роли: от приоритета зависит практика курса.',
      topic: 5,
      practice:
        'Выполнить выбранное действие на учебном стенде и оформить отчёт с проверкой результата.',
    },
  ],
  devops: [
    {
      id: 'platform',
      label: 'На какой платформе отрабатывать сборку и развёртывание сервиса?',
      options: ['Yandex Cloud', 'VK Cloud', 'Учебные серверы компании'],
      recommended: 'Учебные серверы компании',
      reason:
        'Стажировка проходит в ИТ-компании: доступная площадка определит инструменты и задания под руководством наставника.',
      topic: 4,
      practice:
        'Настроить сборку, проверку и развёртывание учебного сервиса на выбранной площадке; приложить результаты к отчёту.',
    },
  ],
};

export function demoContentQuestions(requirements: Requirements): DemoClarification[] {
  return demoClarifications[requirements.demo_example || ''] || [];
}

export function contentQuestions(requirements: Requirements): ClarifyingQuestion[] {
  return requirements.demo_example
    ? demoContentQuestions(requirements)
    : (requirements.model_questions ?? []);
}

export function unansweredContentQuestions(requirements: Requirements) {
  return contentQuestions(requirements)
    .filter((question) => !requirements.clarification_answers?.[question.id]?.trim())
    .map((question) => ({
      ...question,
      field: `clarification_answers.${question.id}`,
    }));
}

export function clarificationReason(requirements: Requirements, topic: number) {
  return demoContentQuestions(requirements)
    .filter((question) => question.topic === topic)
    .flatMap((question) => {
      const answer = requirements.clarification_answers?.[question.id]?.trim();
      return answer
        ? [`Агент уточнил: «${question.label}» Ответ методиста: «${answer}». ${question.reason}`]
        : [];
    })
    .join('\n');
}
