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
  const ratingAction = page.locator('main .feedback-action-trigger');
  await expect(pageFeedback).toBeHidden();
  await ratingAction.click();
  await pageFeedback.getByRole('button', { name: 'Не нравится', exact: true }).click();
  await expect(pageFeedback).toBeHidden();
  await expect(ratingAction).toContainText('Сохранено');
  await ratingAction.click();
  await pageFeedback.getByRole('button', { name: 'Добавить причину' }).click();
  await pageFeedback.getByRole('button', { name: 'Ошибка в часах или структуре' }).click();
  await pageFeedback.getByLabel('Комментарий к отзыву').fill('Практика в теме 2 съела лекции');
  await pageFeedback.getByRole('button', { name: 'Сохранить подробности' }).click();
  await expect(pageFeedback).toBeHidden();
  await expect(ratingAction).toContainText('Сохранено');
  await page.screenshot({ path: '../reports/feedback-page-prompt.png' });

  // Повторный заход показывает прежнюю оценку, а не просит оценить заново.
  await page.reload();
  await expect(ratingAction).toContainText('Сохранено');
  await ratingAction.click();
  await expect(
    page
      .locator('main .response-feedback')
      .getByRole('button', { name: 'Не нравится', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Escape');
  await expect(pageFeedback).toBeHidden();
  await expect(ratingAction).toBeFocused();

  // У разделов независимые оценки; переходы и перезагрузка сохраняют выбор.
  const planUrl = page.url();
  await page.getByRole('link', { name: 'Календарь', exact: true }).click();
  await expect(ratingAction).toHaveText('Оценить календарь');
  await ratingAction.click();
  await pageFeedback.getByRole('button', { name: 'Нравится', exact: true }).click();
  await expect(ratingAction).toContainText('Сохранено');
  await page.getByRole('link', { name: 'О программе', exact: true }).click();
  await expect(ratingAction).toHaveText('Оценить описание');
  await page.getByRole('link', { name: 'Решения', exact: true }).click();
  await expect(ratingAction).toHaveCount(0);
  for (const [route, label] of [
    ['map', 'Оценить карту'],
    ['audit', 'Оценить проверку'],
    ['materials', 'Оценить материалы'],
  ]) {
    await page.goto(planUrl.replace(/plan.*$/, route));
    await expect(ratingAction).toHaveText(label);
    await ratingAction.click();
    await expect(pageFeedback).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(pageFeedback).toBeHidden();
  }
  await page.goto(planUrl);
  await ratingAction.click();
  await expect(
    pageFeedback.getByRole('button', { name: 'Не нравится', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await pageFeedback.getByRole('button', { name: 'Изменить подробности' }).click();
  await expect(pageFeedback.getByLabel('Комментарий к отзыву')).toHaveValue(
    'Практика в теме 2 съела лекции',
  );
  await page.screenshot({ path: '../reports/feedback-compact-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator('.sidebar.is-open').count()) {
    await page.getByRole('button', { name: 'Закрыть навигацию', exact: true }).click();
    await ratingAction.click();
  }
  await expect(pageFeedback).toBeInViewport();
  expect(
    await pageFeedback.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
      );
    }),
  ).toBe(true);
  await page.screenshot({ path: '../reports/feedback-compact-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Escape');

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
  await expect(summary).toContainText('Оценок3');
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
