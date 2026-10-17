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
    s.topics.forEach((topic) => {
      topic.outcome_ids = [];
    });
    s.topics[0].outcome_ids = s.outcomes
      .filter((_, index) => index !== 1)
      .map((outcome) => outcome.id);
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
  await panel.getByRole('button', { name: /Недостаточно оценивания/ }).click();
  await expect(row(1)).toBeVisible();
  await expect(row(2)).toBeVisible();
  await panel.getByRole('button', { name: /Все 5/ }).click();
  await panel.getByRole('button', { name: 'С пробелами 3', exact: true }).click();
  await expect(row(1)).toBeVisible();
  await expect(row(4)).toHaveCount(0);
  await expect(row(5)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Без тем 1', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Без критериев 2', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Без тем 1', exact: true }).click();
  await expect(panel.getByRole('rowheader')).toHaveCount(1);
  await expect(row(2)).toBeVisible();
  await panel.getByRole('button', { name: 'Без критериев 2', exact: true }).click();
  await expect(panel.getByRole('rowheader')).toHaveCount(2);
  await expect(row(2)).toBeVisible();
  await expect(row(3)).toBeVisible();
  await panel.getByRole('button', { name: 'Все 5', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Все 5', exact: true })).toHaveCSS(
    'border-radius',
    '6px',
  );
  await expect(panel.getByRole('button', { name: 'Все 5', exact: true })).toHaveCSS(
    'min-height',
    '32px',
  );
  const help = panel.getByLabel('Справка о покрытии результатов');
  await help.focus();
  await page.keyboard.press('Enter');
  await expect(help).toBeFocused();
  await expect(panel.locator('.coverage-help-content')).toBeVisible();
  await expect(panel.locator('.coverage-help-content')).toContainText('не означают');
  await page.keyboard.press('Space');
  await expect(panel.locator('.coverage-help-content')).toBeHidden();
  // Строка уже раскрыта переходом к заданию выше; задания видны только в раскрытой строке.
  await expect(row(1).getByRole('button', { name: 'Скрыть элементы контроля' })).toBeVisible();
  const chain = panel
    .locator('.coverage-chain')
    .filter({ hasText: 'Цикл корректно обрабатывает список' });
  await expect(chain).toBeVisible();
  await chain.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page.locator('input[name="assessments.0.criterion"]')).toBeFocused();
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await row(2).getByRole('link', { name: 'Исправить', exact: true }).click();
  await detail(2).getByRole('button', { name: 'Добавить проверку', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть настройку связей' }).click();
  const openDisclosures = panel.getByRole('button', { name: 'Скрыть элементы контроля' });
  while (await openDisclosures.count()) await openDisclosures.first().click();
  await page.getByRole('heading', { level: 1 }).click();
  for (const width of [1440, 390, 320]) {
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
    expect(
      await panel
        .locator('.coverage-toolbar')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await help.click();
    await expect(panel.locator('.coverage-help-content')).toBeVisible();
    const helpBounds = await panel.locator('.coverage-help-content').boundingBox();
    expect(helpBounds!.x).toBeGreaterThanOrEqual(0);
    expect(helpBounds!.x + helpBounds!.width).toBeLessThanOrEqual(width);
    await help.click();
    await panel.locator('.coverage-toolbar').screenshot({
      path: `../reports/coverage-toolbar-${width}.png`,
      animations: 'disabled',
      style: '.ai-page-trigger { visibility: hidden; }',
    });
    await panel.screenshot({
      path: `../reports/coverage-${width}.png`,
      animations: 'disabled',
      style: '.ai-page-trigger { visibility: hidden; }',
    });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await expect(panel.getByRole('button', { name: 'Все 5', exact: true })).toHaveCSS(
      'border-radius',
      '6px',
    );
    await panel.screenshot({
      path: `../reports/coverage-dark-${width}.png`,
      animations: 'disabled',
      style: '.ai-page-trigger { visibility: hidden; }',
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
  // Отдельное замечание вне трёх категорий тоже попадает в общий фильтр.
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('courseos-demo-v1')!);
    const course = Object.values(stored.courses)[0] as { snapshots: Snapshot[] };
    course.snapshots
      .at(-1)!
      .skeleton.assessments.find(
        (assessment) => assessment.id === 'coverage-pending-test',
      )!.action = '';
    localStorage.setItem('courseos-demo-v1', JSON.stringify(stored));
  });
  await page.reload();
  await panel.getByRole('button', { name: 'С пробелами 4', exact: true }).click();
  await expect(row(4)).toContainText('Не указана формулировка задания');
  await expect(panel.getByRole('rowheader')).toHaveCount(4);
  await expect(panel.locator('.coverage-summary-complete')).toHaveCount(0);
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('courseos-demo-v1')!);
    const course = Object.values(stored.courses)[0] as { snapshots: Snapshot[] };
    const s = course.snapshots.at(-1)!.skeleton;
    s.outcomes = [s.outcomes[4]];
    localStorage.setItem('courseos-demo-v1', JSON.stringify(stored));
  });
  await page.reload();
  await expect(panel.getByRole('heading')).toHaveText('Покрытие результатов· 1 результат');
  await expect(panel.locator('.coverage-summary-complete')).toHaveText(
    'Связи и критерии заполнены',
  );
  for (const label of ['С пробелами', 'Без тем', 'Недостаточно оценивания', 'Без критериев']) {
    const button = panel.getByRole('button', { name: `${label} 0`, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('rowheader')).toHaveCount(0);
    await expect(panel.getByRole('status')).toHaveText('По выбранному фильтру результатов нет.');
    await expect(button.locator('.has-gaps')).toHaveCount(0);
  }
  await panel.getByRole('button', { name: 'Все 1', exact: true }).click();
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('courseos-demo-v1')!);
    const course = Object.values(stored.courses)[0] as { snapshots: Snapshot[] };
    course.snapshots.at(-1)!.skeleton.outcomes = [];
    localStorage.setItem('courseos-demo-v1', JSON.stringify(stored));
  });
  await page.reload();
  await expect(panel.getByRole('heading')).toHaveText('Покрытие результатов· 0 результатов');
  await expect(panel.getByRole('status')).toHaveText('Результатов обучения пока нет.');
  await expect(panel.locator('.coverage-summary-complete')).toHaveCount(0);
});
