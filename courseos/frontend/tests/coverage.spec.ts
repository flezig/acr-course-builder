import { answerDemoQuestions } from './answer-demo-questions';
import { test, expect } from '@playwright/test';
import { outcomeReviewSignature } from '../src/pages/competencies/outcome-review-model';
import type { Snapshot } from '../src/entities/course/model/schema';
test('Покрытие в программе: три состояния, фильтры, цепочка и редакторы', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await answerDemoQuestions(page);
  await expect(page.locator('.coverage-panel')).toBeVisible();
  const planUrl = page.url();
  const prepared = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('courseos-demo-v1')!);
    const course = Object.values(stored.courses)[0] as { snapshots: Snapshot[] };
    const s = course.snapshots.at(-1)!.skeleton;
    s.outcomes = [
      ...s.outcomes.slice(0, 3),
      { ...s.outcomes[0], id: 'coverage-pending' },
      { ...s.outcomes[0], id: 'coverage-reviewed' },
    ];
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
    for (const outcome of s.outcomes.slice(3)) {
      for (const type of ['test', 'practical'] as const) {
        s.assessments.push({
          ...s.assessments[0],
          id: `${outcome.id}-${type}`,
          type,
          outcome_ids: [outcome.id],
          criterion: 'Проверочный критерий',
        });
      }
    }
    localStorage.setItem('courseos-demo-v1', JSON.stringify(stored));
    return s;
  });
  await page.evaluate(
    (signature) => {
      const stored = JSON.parse(localStorage.getItem('courseos-demo-v1')!);
      const course = Object.values(stored.courses)[0] as { snapshots: Snapshot[] };
      course.snapshots.at(-1)!.skeleton.outcomes[4].review = {
        signature,
        checked_at: '2026-10-17T00:00:00.000Z',
      };
      localStorage.setItem('courseos-demo-v1', JSON.stringify(stored));
    },
    outcomeReviewSignature(prepared, prepared.outcomes[4].id),
  );
  await page.reload();
  const panel = page.locator('.coverage-panel');
  const row = (n: number) =>
    panel.locator('tr').filter({
      has: page.getByRole('rowheader').filter({ hasText: `Контрольный результат ${n}` }),
    });
  const detail = (n: number) => panel.locator('.coverage-detail').nth(n - 1);
  await expect(row(1)).toContainText('Нужно второе оценочное средство');
  await expect(row(1).locator('.coverage-status')).toHaveText('Нужно дополнить');
  await expect(row(1)).toContainText('Методист ещё не проверил');
  await expect(row(2)).toContainText('Нет проверочного задания');
  await expect(row(3)).toContainText('Не указаны критерии');
  await expect(row(4).locator('.coverage-status')).toHaveText('Ожидает проверки');
  await expect(row(4)).toContainText('Связи и критерии заполнены');
  await expect(row(5).locator('.coverage-status')).toHaveText('Проверено методистом');
  await expect(row(5).getByRole('link', { name: 'Проверить', exact: true })).toHaveCount(0);
  await row(4).getByRole('link', { name: 'Проверить', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Контрольный результат 4', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.outcome-content')).toBeVisible();
  await page.goto(planUrl);
  await row(3).getByRole('link', { name: 'Исправить', exact: true }).click();
  await expect(detail(3)).toBeVisible();
  await expect(detail(3)).toBeFocused();
  await detail(3).getByRole('button', { name: 'Указать критерии', exact: true }).click();
  await expect(page.locator('input[name="assessments.1.criterion"]')).toBeFocused();
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await page.locator('.topic-assessment a[href$="-check-complete"]').first().click();
  await expect(panel.locator('[id$="-check-complete"]')).toBeVisible();
  await expect(panel.locator('[id$="-check-complete"]')).toBeFocused();
  await panel.getByRole('button', { name: /Недостаточно оценочных средств/ }).click();
  await expect(row(1)).toBeVisible();
  await expect(row(2)).toBeVisible();
  await panel.getByRole('button', { name: /Всего результатов/ }).click();
  await panel.getByLabel('Только с пробелами').check();
  await expect(row(1)).toBeVisible();
  await panel.getByLabel('Только с пробелами').uncheck();
  // Строка уже раскрыта переходом к заданию выше; задания видны только в раскрытой строке.
  await expect(row(1).getByRole('button', { name: 'Скрыть элементы контроля' })).toBeVisible();
  const chain = panel
    .locator('.coverage-chain')
    .filter({ hasText: 'Цикл корректно обрабатывает список' });
  await expect(chain).toBeVisible();
  await chain.getByRole('button', { name: 'Открыть задание' }).click();
  await expect(page.locator('input[name="assessments.0.criterion"]')).toBeFocused();
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await row(2).getByRole('link', { name: 'Исправить', exact: true }).click();
  await detail(2).getByRole('button', { name: 'Добавить проверку', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть настройку связей' }).click();
  const openDisclosures = panel.getByRole('button', { name: 'Скрыть элементы контроля' });
  while (await openDisclosures.count()) await openDisclosures.first().click();
  await page.getByRole('heading', { level: 1 }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const closeNavigation = page.getByRole('button', { name: 'Закрыть навигацию', exact: true });
    if (await page.locator('.sidebar.is-open').count()) await closeNavigation.click();
    await expect(panel).toBeVisible();
    await panel.locator('.table-scroll').evaluate((element) => element.scrollTo(0, 0));
    await expect(panel.locator('td').first()).toHaveCSS('text-align', 'left');
    expect(
      await panel
        .locator('.table-scroll')
        .evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth &&
            element.scrollHeight <= element.clientHeight,
        ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await panel.screenshot({ path: `../reports/coverage-${width}.png`, animations: 'disabled' });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await panel.screenshot({
      path: `../reports/coverage-dark-${width}.png`,
      animations: 'disabled',
    });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
  }
  await page.reload();
  await expect(detail(2)).toBeVisible();
  await page.goto(planUrl.replace(/\/plan.*/, '/map'));
  await expect(page.locator('.results-map')).toBeVisible();
  await expect(page.locator('.coverage-panel')).toHaveCount(0);
  await page.goto(`${planUrl.replace(/\/plan.*/, '/map')}#coverage`);
  await expect(page).toHaveURL(/\/plan#coverage$/);
  await expect(page.locator('.coverage-panel')).toBeVisible();
});
