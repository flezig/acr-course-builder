import { answerDemoQuestions } from './answer-demo-questions';
import { test, expect } from '@playwright/test';

test('Оценки, решения по правкам ИИ и разбор жалоб попадают в сводку', async ({ page }) => {
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

  // Оценка сохраняется по клику, подробности добавляются к ней.
  const pageFeedback = page.locator('main .response-feedback');
  await pageFeedback.getByRole('button', { name: 'Не нравится', exact: true }).click();
  await pageFeedback.getByRole('button', { name: 'Ошибка в часах или структуре' }).click();
  await pageFeedback.getByLabel('Комментарий к отзыву').fill('Практика в теме 2 съела лекции');
  await pageFeedback.getByRole('button', { name: 'Сохранить подробности' }).click();
  await expect(pageFeedback).toContainText('Оценка сохранена');
  await page.screenshot({ path: '../reports/feedback-page-prompt.png' });

  // Повторный заход показывает прежнюю оценку, а не просит оценить заново.
  await page.reload();
  await expect(
    page
      .locator('main .response-feedback')
      .getByRole('button', { name: 'Не нравится', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Изменить с ИИ' }).click();
  const dialog = page.getByRole('dialog', { name: 'Правка с помощью ИИ' });
  const editFeedback = dialog.locator('.response-feedback');
  await editFeedback.getByRole('button', { name: 'Нравится', exact: true }).click();
  await expect(editFeedback.getByRole('button', { name: 'Нравится', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await editFeedback.getByRole('button', { name: 'Без подробностей' }).click();
  await expect(editFeedback).toContainText('Оценка сохранена');
  for (const reject of await dialog.getByRole('button', { name: 'Оставить' }).all())
    await reject.click();
  await page.screenshot({ path: '../reports/feedback-ai-edit.png' });
  await dialog.getByRole('button', { name: 'Завершить без изменений' }).click();
  await expect(dialog).toContainText('Это учтено в отзывах');

  await page.goto('/feedback');
  const summary = page.locator('.feedback-summary');
  await expect(summary).toContainText('Оценок2');
  await expect(summary).toContainText('Жалоб ждут разбора1');
  await expect(summary).toContainText('Принято правок ИИ0%');
  await expect(page.locator('.panel', { hasText: 'Чаще всего отклоняют' })).toContainText(
    'Тема · содержание',
  );
  await page.getByLabel('Статус разбора: Первые шаги в Python').selectOption('in_progress');
  await expect(summary).toContainText('Жалоб ждут разбора0');
  await page.getByLabel('Разбор жалоб').selectOption('in_progress');
  await expect(page.locator('.feedback-entry')).toHaveCount(1);
  await page.getByLabel('Разбор жалоб').selectOption('all');
  await page.screenshot({ path: '../reports/feedback-summary.png', fullPage: true });
});
