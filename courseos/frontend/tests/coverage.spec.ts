import { test, expect } from '@playwright/test';
import type { Snapshot } from '../src/entities/course/model/schema';
test('Покрытие в каркасе: три состояния, фильтры, цепочка и редакторы', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.coverage-panel')).toBeVisible();
  const planUrl = page.url();
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('courseos-demo-v1')!);
    const course = Object.values(stored.courses)[0] as { snapshots: Snapshot[] };
    const s = course.snapshots.at(-1)!.skeleton;
    s.outcomes = s.outcomes.slice(0, 3);
    s.outcomes.forEach((outcome, index) => {
      outcome.title = `Контрольный результат ${index + 1}`;
      outcome.criteria = [];
      delete outcome.review;
    });
    s.topics[0].outcome_ids = s.outcomes.map((outcome) => outcome.id);
    s.assessments = [
      {
        ...s.assessments[0],
        id: 'check-complete',
        topic_id: s.topics[0].id,
        outcome_ids: [s.outcomes[0].id],
        action: 'Написать программу с циклом',
        criterion: 'Цикл корректно обрабатывает список',
      },
      {
        ...s.assessments[0],
        id: 'check-no-criterion',
        topic_id: s.topics[0].id,
        outcome_ids: [s.outcomes[2].id],
        action: 'Исправить ошибку в программе',
        criterion: '',
      },
    ];
    localStorage.setItem('courseos-demo-v1', JSON.stringify(stored));
  });
  await page.reload();
  const panel = page.locator('.coverage-panel');
  const row = (n: number) =>
    panel.locator('tr').filter({
      has: page.getByRole('rowheader').filter({ hasText: `Контрольный результат ${n}` }),
    });
  await expect(row(1)).toContainText('Нужно второе оценочное средство другого типа');
  await expect(
    row(1).getByRole('button', { name: 'Добавить проверку', exact: true }),
  ).toBeVisible();
  await expect(row(1)).toContainText('Соответствие требует проверки');
  await expect(row(2)).toContainText('Нет проверочного задания');
  await expect(row(3)).toContainText('Не указаны критерии');
  await panel.getByRole('button', { name: /Недостаточно оценочных средств/ }).click();
  await expect(row(1)).toBeVisible();
  await expect(row(2)).toBeVisible();
  await panel.getByRole('button', { name: /Всего результатов/ }).click();
  await panel.getByLabel('Только с пробелами').check();
  await expect(row(1)).toBeVisible();
  await panel.getByLabel('Только с пробелами').uncheck();
  await row(1)
    .getByRole('link', { name: /Написать программу/ })
    .click();
  const chain = panel.locator('.coverage-chain').first();
  await expect(chain).toBeVisible();
  await expect(chain).toContainText('Цикл корректно обрабатывает список');
  await chain.getByRole('button', { name: 'Открыть задание' }).click();
  await expect(page.locator('input[name="assessments.0.criterion"]')).toBeFocused();
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await row(2).getByRole('button', { name: 'Добавить проверку', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть настройку связей' }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const closeNavigation = page.getByRole('button', { name: 'Закрыть навигацию', exact: true });
    if (await page.locator('.sidebar.is-open').count()) await closeNavigation.click();
    await expect(panel).toBeVisible();
    await panel.locator('.table-scroll').evaluate((element) => element.scrollTo(0, 0));
    await expect(panel.locator('td').first()).toHaveCSS('text-align', 'left');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await panel.screenshot({ path: `../reports/coverage-${width}.png`, animations: 'disabled' });
  }
  await page.reload();
  await expect(page.locator('.coverage-chain').first()).toBeVisible();
  await page.goto(planUrl.replace(/\/plan.*/, '/map'));
  await expect(page.locator('.results-map')).toBeVisible();
  await expect(page.locator('.coverage-panel')).toHaveCount(0);
  await page.goto(`${planUrl.replace(/\/plan.*/, '/map')}#coverage`);
  await expect(page).toHaveURL(/\/plan#coverage$/);
  await expect(page.locator('.coverage-panel')).toBeVisible();
});
