import { expect, test } from '@playwright/test';

test('Методист заменяет профстандарт, добавляет свою редакцию и убирает привязку', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'ИИ в работе учителя 36 часов · учителя · повышение квалификации',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.verdict')).toBeVisible();
  await page.getByRole('link', { name: 'Учебный план', exact: true }).click();
  await page.getByRole('link', { name: 'О программе', exact: true }).click();
  const standard = page.locator('#standard');
  await expect(standard).toContainText('01.001');
  await standard.getByRole('button', { name: 'Изменить профстандарт' }).click();
  await standard.getByLabel('Профстандарт программы').selectOption('devops');
  await standard.getByRole('button', { name: 'Сохранить профстандарт' }).click();
  await expect(standard.getByLabel('Профстандарт программы')).toHaveCount(0);
  await expect(standard).toContainText('06.026');
  await page.reload();
  await expect(standard).toContainText('06.026');
  await standard.getByRole('button', { name: 'Изменить профстандарт' }).click();
  await standard.getByLabel('Профстандарт программы').selectOption('custom');
  await standard.getByLabel('Название и код профстандарта').fill('Другая редакция для проверки');
  await standard
    .getByLabel('Текст профстандарта', { exact: true })
    .fill('Текст, предоставленный методистом для проверки.');
  await standard.getByRole('button', { name: 'Сохранить профстандарт' }).click();
  await expect(standard).toContainText('предоставлен методистом');
  await page.reload();
  await standard.getByRole('button', { name: 'Изменить профстандарт' }).click();
  await expect(standard.getByLabel('Название и код профстандарта')).toHaveValue(
    'Другая редакция для проверки',
  );
  await standard.getByLabel('Профстандарт программы').selectOption('');
  await standard.getByRole('button', { name: 'Сохранить профстандарт' }).click();
  await expect(standard).toContainText('текст профстандарта не приложен');
  await page.reload();
  await expect(standard).toContainText('текст профстандарта не приложен');
});
