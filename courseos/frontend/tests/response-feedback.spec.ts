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
  await expect(page.locator('main .response-feedback')).toHaveCount(0);
  await answerDemoQuestions(page);
  await expect(page.locator('.verdict')).toBeVisible();

  // Оценка сохраняется по клику, подробности добавляются к ней.
  const pageFeedback = page.locator('main .response-feedback');
  const ratingAction = page.locator('main .feedback-action-trigger');
  await expect(pageFeedback).toBeVisible();
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
  await expect(pageFeedback).toContainText('Оценка сохранена');
  await expect(
    page
      .locator('main .response-feedback')
      .getByRole('button', { name: 'Не нравится', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  await pageFeedback.getByRole('button', { name: 'Закрыть оценку' }).click();
  await expect(pageFeedback).toBeHidden();

  // У разделов независимые оценки; переходы и перезагрузка сохраняют выбор.
  const planUrl = page.url();
  await page.getByRole('link', { name: 'Календарь', exact: true }).click();
  await expect(pageFeedback).toContainText('Насколько полезен календарь?');
  await pageFeedback.getByRole('button', { name: 'Нравится', exact: true }).click();
  await expect(ratingAction).toContainText('Сохранено');
  await page.getByRole('link', { name: 'О программе', exact: true }).click();
  await expect(pageFeedback).toContainText('Насколько полезно описание программы?');
  await page.getByRole('link', { name: 'Решения', exact: true }).click();
  await expect(ratingAction).toHaveCount(0);
  for (const [route, label] of [
    ['map', 'Насколько полезна карта результатов?'],
    ['audit', 'Насколько полезны результаты проверки?'],
  ]) {
    await page.goto(planUrl.replace(/plan.*$/, route));
    await expect(pageFeedback).toContainText(label);
    await expect(page.locator('header .response-feedback')).toHaveCount(0);
  }
  await page.goto(planUrl);
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
  }
  await pageFeedback.scrollIntoViewIfNeeded();
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
  await pageFeedback.getByRole('button', { name: 'Закрыть оценку' }).click();

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

for (const width of [1440, 390]) {
  test(`Оценка находится под результатом и скрыта без готового ответа: ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const prompt = page.locator('main .response-feedback');
    await expect(prompt).toHaveCount(0);
    await page
      .getByRole('button', {
        name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
    await answerDemoQuestions(page);
    await expect(prompt).toBeVisible();
    if (await page.locator('.sidebar.is-open').count())
      await page.getByRole('button', { name: 'Закрыть навигацию', exact: true }).click();
    const planUrl = page.url();
    const courseId = planUrl.match(/courses\/([^/]+)/)![1];

    // Новая версия не наследует оценку предыдущего результата.
    await prompt.getByRole('button', { name: 'Не нравится', exact: true }).click();
    await page.getByRole('button', { name: 'Редактировать программу', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Цель', exact: true })
      .fill('Освоить Python и написать свою программу.');
    await page.getByRole('button', { name: 'Сохранить новую версию', exact: true }).click();
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'Нравится', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await prompt.getByRole('button', { name: 'Нравится', exact: true }).click();
    const ratings = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('courseos-feedback-demo')!),
    );
    expect(ratings.map((entry: { course_version: number }) => entry.course_version)).toEqual([
      1, 2,
    ]);

    await page.goto(planUrl.replace(/plan.*$/, 'materials'));
    await expect(prompt).toHaveCount(0);
    await page.goto(planUrl);
    await page.getByRole('button', { name: 'Утвердить', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить утверждение', exact: true }).click();
    await expect(
      page.locator('.verdict').getByRole('link', { name: 'Перейти к материалам', exact: true }),
    ).toBeVisible({ timeout: 15000 });

    for (const [route, result, question] of [
      ['plan', '.plan-layout', 'Насколько полезен учебный план?'],
      ['plan#calendar', '.plan-layout', 'Насколько полезен календарь?'],
      ['plan#intent', '.plan-layout', 'Насколько полезно описание программы?'],
      ['map', '.results-workspace', 'Насколько полезна карта результатов?'],
      ['audit', '.audit-section', 'Насколько полезны результаты проверки?'],
      [
        'materials',
        '.materials-layout .panel:last-of-type',
        'Насколько полезны материалы программы?',
      ],
    ]) {
      await page.goto(planUrl.replace(/plan.*$/, route));
      await expect(prompt).toContainText(question);
      await prompt.scrollIntoViewIfNeeded();
      const bounds = await prompt.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          position: getComputedStyle(element).position,
        };
      });
      const results = page.locator(result);
      const bottom = await results.evaluateAll((elements) =>
        Math.max(...elements.map((element) => element.getBoundingClientRect().bottom)),
      );
      expect(bounds.top).toBeGreaterThanOrEqual(bottom);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(['static', 'relative']).toContain(bounds.position);
      await expect(page.locator('header .feedback-action')).toHaveCount(0);
      await page.screenshot({
        path: `../reports/feedback-${route.replace('#', '-')}-${width}.png`,
      });
    }

    // Сохраняем старый результат, пока новая генерация грузится или завершилась ошибкой.
    const stored = await page.evaluate(() => localStorage.getItem('courseos-demo-v1')!);
    for (const status of ['queued', 'running', 'failed', 'cancelled', 'awaiting_clarification']) {
      await page.evaluate(
        ({ stored, courseId, status }) => {
          const database = JSON.parse(stored);
          database.courses[courseId].job.status = status;
          database.courses[courseId].job.started_at = new Date(Date.now() + 60000).toISOString();
          localStorage.setItem('courseos-demo-v1', JSON.stringify(database));
        },
        { stored, courseId, status },
      );
      for (const route of ['plan', 'map', 'audit', 'materials']) {
        await page.goto(planUrl.replace(/plan.*$/, route));
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(prompt).toHaveCount(0);
      }
    }
    await page.evaluate((stored) => localStorage.setItem('courseos-demo-v1', stored), stored);
    await page.goto(planUrl);
    await expect(prompt).toBeVisible();
  });
}
