import { answerDemoQuestions, chooseRecommendedAnswers } from './answer-demo-questions';
import { test, expect, type Page } from '@playwright/test';

async function pythonCourse(page: Page) {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая' })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await answerDemoQuestions(page);
  await expect(page.locator('.verdict')).toBeVisible();
}

test('Creation requires a request before submitting', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая' })
    .click();
  const request = page.getByLabel('Запрос методиста');
  await request.fill('   ');
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(request).toBeFocused();
  await expect(request).toHaveAttribute('aria-invalid', 'true');
  await request.fill('Курс Python для школьников без опыта программирования, 16 часов');
  await page.locator('.parameter-summary > summary').click();
  await page
    .getByRole('checkbox', { name: 'Подтверждаю параметры изменённого запроса вручную' })
    .check();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await answerDemoQuestions(page);
  await expect(page.locator('.verdict')).toBeVisible();
});

test('Clarifications reject the screenshot input locally and require a program type', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Кибербезопасность.*Неполный запрос/ }).click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await chooseRecommendedAnswers(page);
  const hours = page.getByLabel('Какой объём в часах?', { exact: true });
  await hours.fill('вава');
  await expect(hours).toHaveAccessibleDescription(/Введите неотрицательное число/);
  for (const [label, value] of [
    ['Какой входной уровень слушателей?', 'Основы сетей и Linux'],
    ['В какой форме проходит обучение?', 'Очно'],
    ['Какая итоговая аттестация предусмотрена?', 'Проект'],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  const submit = page.getByRole('button', { name: 'Сохранить ответы и построить программу' });
  await submit.click();
  const type = page.getByLabel('Какой тип программы нужен?', { exact: true });
  await expect(type).toHaveAccessibleDescription('Выберите тип программы.');
  await expect(type).toBeFocused();
  await type.selectOption('acr_general');
  await hours.fill('501');
  await expect(hours).toHaveAccessibleDescription(/от 16 до 500/);
  await submit.click();
  await expect(hours).toBeFocused();
  await expect(page.locator('.notice.error')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('inline-validation-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('inline-validation-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await hours.fill('72,5');
  await submit.click();
  await expect(page.locator('.verdict')).toBeVisible();
});

test('Program editor validates table cells before saving and keeps the entered draft', async ({
  page,
}) => {
  await pythonCourse(page);
  await page.getByRole('button', { name: 'Редактировать программу', exact: true }).click();
  const total = page.getByLabel('Заявленный объём темы 1', { exact: true });
  await total.fill('не число');
  await expect(total).toHaveAccessibleDescription(/Введите неотрицательное число/);
  await page.getByRole('button', { name: 'Сохранить новую версию' }).click();
  await expect(total).toBeFocused();
  await expect(total).toHaveValue('не число');
  await expect(page.locator('.notice.error')).toHaveCount(0);
  await total.fill('2,5');
  await expect(total).toHaveAttribute('aria-invalid', 'false');
  await page.getByRole('button', { name: 'Сохранить новую версию' }).click();
  await expect(page.getByRole('heading', { name: 'Редактирование программы' })).toHaveCount(0);
});

test('Source actions validate complete HTTP URLs inline, before adding a source', async ({
  page,
}) => {
  await pythonCourse(page);
  await page.getByRole('link', { name: 'Карта результатов', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить текст, PDF, DOCX или ссылку' }).click();
  const url = page.getByLabel('Ссылка', { exact: true });
  await url.fill('https://');
  await expect(url).toHaveAccessibleDescription(/Введите полную ссылку/);
  await page.getByRole('button', { name: 'Добавить источник', exact: true }).click();
  await expect(url).toBeFocused();
  await expect(page.locator('.reference-item')).toHaveCount(0);
  await url.fill('https://example.com/guide');
  await expect(url).toHaveAttribute('aria-invalid', 'false');
  await page.getByRole('button', { name: 'Добавить источник', exact: true }).click();
  await expect(url).toHaveValue('');
  await page.getByRole('button', { name: 'Добавить источник', exact: true }).click();
  const text = page.getByLabel('Текст референса', { exact: true });
  await expect(text).toBeFocused();
  await expect(text).toHaveAccessibleDescription('Вставьте текст или ссылку.');
  await text.fill('Фрагмент требований');
  await expect(text).toHaveAttribute('aria-invalid', 'false');
});

test('Material editing validates before saving', async ({ page }) => {
  await pythonCourse(page);
  await page.getByRole('link', { name: 'Решения и утверждение', exact: true }).click();
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: 'Цель, результаты, часы, оценивание и основания проверены. Утверждаю эту версию.',
    })
    .check();
  await page.getByRole('button', { name: 'Утвердить программу', exact: true }).click();
  await page
    .locator('.verdict')
    .getByRole('link', { name: 'Перейти к материалам', exact: true })
    .click();
  await expect(
    page.locator('.job-panel').getByText('Нужна проверка', { exact: true }),
  ).toBeVisible();
  await page
    .locator('.material-list')
    .getByRole('button', {
      name: 'Рабочая программа: Знакомство с Python Рабочая программа',
      exact: true,
    })
    .click();
  await expect(page.locator('.material-viewer')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ручная правка', exact: true }).click();
  const content = page.getByLabel('Содержание материала', { exact: true });
  await content.fill('   ');
  await page.getByRole('button', { name: 'Посмотреть изменения и зависимости' }).click();
  await expect(content).toBeFocused();
  await expect(content).toHaveAccessibleDescription('Заполните это поле.');
  await content.fill('Задание: проверьте два сценария ввода.');
  await page.getByRole('button', { name: 'Посмотреть изменения и зависимости' }).click();
  await page
    .getByRole('button', { name: 'Применить правку и сохранить версию', exact: true })
    .click();
  await expect(page.getByText('Ручная правка защищена')).toBeVisible();
});

test('Outcome editing uses inline required checks for controlled fields', async ({ page }) => {
  await pythonCourse(page);
  await page.getByRole('link', { name: 'Карта результатов', exact: true }).click();
  await page.getByRole('button', { name: 'Перейти к таблице' }).click();
  await page
    .locator('.outcome-content')
    .getByRole('button', { name: 'Редактировать', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  const title = dialog.getByLabel('Короткое название', { exact: true });
  await title.fill('   ');
  await expect(title).toHaveValue('   ');
  await expect(title).toHaveAccessibleDescription('Заполните это поле.');
  const description = dialog.getByLabel('Наблюдаемое действие учащегося', { exact: true });
  await description.fill('   ');
  await expect(description).toHaveAccessibleDescription('Заполните это поле.');
  await expect(
    dialog.getByRole('button', { name: 'Просмотреть изменения', exact: true }),
  ).toBeDisabled();
  await title.fill('Вывод данных');
  await description.fill('Выводит строку и значение переменной с помощью print.');
  await expect(title).toHaveAttribute('aria-invalid', 'false');
  await expect(description).toHaveAttribute('aria-invalid', 'false');
  await dialog.getByRole('button', { name: 'Просмотреть изменения', exact: true }).click();
  await expect(dialog).toContainText('Предложенная версия');
});
