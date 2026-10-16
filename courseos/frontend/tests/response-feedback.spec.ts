import { answerDemoQuestions } from './answer-demo-questions';
import { test, expect } from '@playwright/test';

test('Отзывы о сгенерированной странице и правке ИИ попадают в сводку', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await answerDemoQuestions(page);
  await expect(page.locator('.verdict')).toBeVisible();

  const pageFeedback = page.locator('main .response-feedback');
  await pageFeedback.getByRole('button', { name: 'Не нравится', exact: true }).click();
  await pageFeedback.getByRole('button', { name: 'Ошибка в часах или структуре' }).click();
  await pageFeedback.getByLabel('Комментарий к отзыву').fill('Практика в теме 2 съела лекции');
  await pageFeedback.getByRole('button', { name: 'Отправить отзыв' }).click();
  await expect(pageFeedback).toContainText('Спасибо, отзыв сохранён');
  await page.screenshot({ path: '../reports/feedback-page-prompt.png' });

  await page.getByRole('button', { name: 'Изменить с ИИ' }).click();
  const dialog = page.getByRole('dialog', { name: 'Правка с помощью ИИ' });
  const editFeedback = dialog.locator('.response-feedback');
  await editFeedback.getByRole('button', { name: 'Нравится', exact: true }).click();
  await editFeedback.getByRole('button', { name: 'Точно по запросу' }).click();
  await page.screenshot({ path: '../reports/feedback-ai-edit.png' });
  await editFeedback.getByRole('button', { name: 'Отправить отзыв' }).click();
  await expect(editFeedback).toContainText('Спасибо, отзыв сохранён');

  await editFeedback.getByRole('link', { name: 'Все отзывы' }).click();
  await expect(page.getByRole('heading', { name: 'Отзывы о генерации' })).toBeVisible();
  const summary = page.locator('.feedback-summary');
  await expect(summary).toContainText('Всего2');
  await expect(summary).toContainText('Доля положительных50%');
  await expect(page.locator('.feedback-reasons-list')).toContainText(
    'Ошибка в часах или структуре1',
  );
  await expect(page.locator('.feedback-entry.down')).toContainText(
    'Практика в теме 2 съела лекции',
  );
  await page.getByLabel('Оценка').selectOption('up');
  await expect(page.locator('.feedback-entry')).toHaveCount(1);
  await expect(page.locator('.feedback-entry')).toContainText('Правка с ИИ');
  await page.getByLabel('Оценка').selectOption('all');
  await page.screenshot({ path: '../reports/feedback-summary.png', fullPage: true });
});
