import { answerDemoQuestions } from './answer-demo-questions';
import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '../src/entities/course/model/schema';

async function create(page: Page, example: string) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(example) }).click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await answerDemoQuestions(page);
  await expect(page.locator('.course-heading h1')).toBeVisible();
  return page.url().match(/courses\/([^/]+)/)![1];
}
async function pythonMaterials(page: Page) {
  const id = await create(page, '^Первые шаги в Python');
  await page.goto(`/courses/${id}/plan#approve`);
  await page
    .getByLabel('Цель, результаты, часы, оценивание и основания проверены. Утверждаю эту версию.')
    .check();
  await page.getByRole('button', { name: 'Утвердить программу', exact: true }).click();
  await expect(page.locator('.approval-panel')).toContainText('Программа утверждена');
  await page.goto(`/courses/${id}/materials?material=test-final`);
  await expect(page.locator('#question-1')).toBeVisible({ timeout: 15000 });
  return id;
}
async function exported(page: Page, id: string, version: number): Promise<Snapshot> {
  await page.goto(`/courses/${id}/materials?version=${version}&tab=exports`);
  const pending = page.waitForEvent('download');
  await page
    .locator('.export-file')
    .filter({ hasText: 'Полные данные курса' })
    .getByRole('button')
    .click();
  const file = await pending;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

test('изменённый банковский запрос требует сверки и передаёт 48 ч / три недели во все представления', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Анализ данных на Python/ }).click();
  const request = page.getByLabel('Запрос методиста');
  await request.fill(
    (await request.inputValue()).replace('72 часа', '48 часов').replace('4 недели', 'три недели'),
  );
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.getByText('Устраните расхождения текста и сводки.')).toBeVisible();
  await page.getByLabel('Объём в часах').fill('48');
  await page.getByLabel('Срок в неделях').fill('3');
  await page.getByLabel('Максимум часов в день').fill('4');
  await page.getByLabel('Подтверждаю параметры изменённого запроса вручную').check();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.volume-summary')).toContainText('48');
  const id = page.url().match(/courses\/([^/]+)/)![1];
  await page.goto(`/courses/${id}/plan#calendar`);
  await expect(page.locator('.calendar-summary')).toContainText('21 календарных дней');
  const data = await exported(page, id, 1);
  expect(data.skeleton.requirements).toMatchObject({
    total_hours: '48',
    calendar: { calendar_days: 21 },
  });
});

test('DevOps: обычное подтверждение не меняет 4 ч и не снимает дефицит', async ({ page }) => {
  const id = await create(page, '^DevOps:');
  await page.goto(`/courses/${id}/plan#review`);
  const issue = page.locator('#issue-calendar-unknown');
  await expect(issue).toContainText('64 учебных дней');
  await issue.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.locator('#issue-calendar-capacity')).toContainText('32');
  await page.goto(`/courses/${id}/plan#calendar`);
  await expect(page.locator('.calendar-summary')).toContainText('4');
  await page
    .locator('.calendar-panel')
    .screenshot({ path: '../reports/audit-fixes-calendar-desktop.png' });
  const data = await exported(page, id, 2);
  expect(data.skeleton.requirements.calendar.daily_limit).toBe('4');
  expect(data.audit.issues.some((i) => i.id === 'calendar-capacity' && i.blocking)).toBe(true);
});

test('исключение профстандарта остаётся исключением в отчёте', async ({ page }) => {
  const id = await create(page, '^Анализ данных на Python');
  await page.goto(`/courses/${id}/plan#review`);
  const standard = page.locator('#issue-professional-standard');
  await standard.getByRole('button', { name: 'Оставить как есть' }).click();
  await standard.getByLabel('Почему оставить как есть').fill('Связи проверит эксперт до выпуска');
  await standard.getByRole('button', { name: 'Сохранить решение' }).click();
  await expect(page.locator('.save-feedback')).toContainText('Причина сохранена');
  await page.goto(`/courses/${id}/audit`);
  const check = page
    .locator('.checklist-item')
    .filter({ hasText: 'Профстандарт и его код существуют' });
  await expect(check).toContainText('Принято исключение');
  await expect(check).toContainText('коды результатов не заполнены');
  await expect(check.locator('.green-icon')).toHaveCount(0);
});

test('вопрос, слайд, фильтры и выбранные версии согласованы; мобильный редактор не выходит за экран', async ({
  page,
}) => {
  const id = await pythonMaterials(page);
  const question = page.locator('#question-1');
  await question.getByRole('button', { name: 'Редактировать вопрос' }).click();
  const editor = question.getByRole('region', { name: 'Редактировать вопрос' });
  await editor.getByLabel('Формулировка вопроса').fill('Что выведет print(3 * 4)?');
  await editor.getByLabel('Варианты ответа').fill('7\n12\n34');
  await editor.getByLabel('Номер верного ответа').fill('2');
  await editor.getByLabel('Объяснение ответа').fill('Умножение трёх на четыре даёт 12.');
  await editor.getByRole('button', { name: 'Посмотреть изменения и зависимости' }).click();
  await expect(editor.getByLabel('Предпросмотр правки')).toContainText('Верный вариант: 2');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await editor.getByRole('button', { name: 'Применить правку и сохранить версию' }).click();
  await expect(question.locator('.correct-option')).toContainText('12');
  await page.screenshot({ path: '../reports/audit-fixes-question-mobile.png', fullPage: true });
  await page.goto(`/courses/${id}/materials?material=lecture-topic-1`);
  const slide = page.locator('.slide').first();
  await slide.getByRole('button', { name: 'Редактировать слайд' }).click();
  await slide.getByLabel('Заголовок слайда').fill('Первый запуск программы');
  await slide.getByLabel('Содержание слайда').fill('print(3 * 4) выводит 12');
  await slide.getByLabel('Заметки преподавателя').fill('Попросите объяснить вычисление.');
  await slide.getByRole('button', { name: 'Посмотреть изменения и зависимости' }).click();
  await slide.getByRole('button', { name: 'Применить правку и сохранить версию' }).click();
  await expect(slide.getByRole('heading', { name: 'Первый запуск программы' })).toBeVisible();
  await page.getByLabel('Модуль', { exact: true }).selectOption('module-2');
  await expect(
    page.locator('.material-viewer').filter({ hasText: 'Первый запуск программы' }),
  ).toHaveCount(0);
  await page.getByLabel('Тип материала').selectOption('project');
  await expect(page.getByText('Материалов с таким фильтром нет')).toBeVisible();
  await expect(page.locator('.material-viewer')).toHaveCount(0);
  await page.goto(`/courses/${id}/compare?version=1&before=2&after=4`);
  await expect(page.getByRole('combobox', { name: 'Стало' })).toHaveValue('4');
  await expect(page.locator('main')).toContainText('Первый запуск программы');
  await expect(page.locator('main a[href*="tab=exports"]').first()).toHaveAttribute(
    'href',
    new RegExp('version=4'),
  );
  const data = await exported(page, id, 4);
  expect(data.course_version).toBe(4);
  expect(data.materials.find((m) => m.id === 'test-final')!.questions[0].correct_index).toBe(1);
  expect(data.materials.find((m) => m.id === 'lecture-topic-1')!.slides[0].title).toBe(
    'Первый запуск программы',
  );
});

test('расписание Python содержит два занятия в неделю, разделы и недоступные экспорты можно просмотреть', async ({
  page,
}) => {
  const id = await pythonMaterials(page);
  await page.goto(`/courses/${id}/plan#calendar`);
  await expect(page.locator('.load-days')).toContainText('Знакомство с Python');
  await expect(page.locator('.load-days')).toContainText('Переменные и типы');
  await expect(page.locator('.load-day').filter({ hasText: '2 уч. ч.' })).toHaveCount(2);
  await page.goto(`/courses/${id}/materials#sections`);
  await expect(page.getByRole('heading', { name: 'Разделы выбранного образца' })).toBeVisible();
  await page.getByText('1.3 Цель и задачи · Поля заполнены', { exact: true }).click();
  await expect(page.locator('#sections')).toContainText('Создать простую программу');
  await page.goto(`/courses/${id}/audit`);
  await expect(
    page.locator('.checklist-item').filter({ hasText: 'Выгрузка в .docx' }),
  ).toContainText('Недоступно в демо');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('исходное повреждённое хранилище скачивается без предварительного сброса', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('courseos-demo-v1', '{сохранённая работа'));
  await page.goto('/');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать исходные данные и всю историю' }).click();
  const file = await pending;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe('{сохранённая работа');
});
