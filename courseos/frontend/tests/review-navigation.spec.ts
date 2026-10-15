import { test, expect, type Page } from '@playwright/test';

async function create(page: Page, teacher = false) {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: teacher
        ? 'ИИ в работе учителя 36 часов · учителя · повышение квалификации'
        : 'Первые шаги в Python 16 часов · школьники · общеразвивающая',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.goal-statement')).toBeVisible();
  await page.getByRole('link', { name: 'Проверка и утверждение', exact: true }).click();
}

test('Blocking remarks: first-screen summary, contextual correction and keyboard navigation', async ({
  page,
}) => {
  await create(page, true);
  const summary = page.getByRole('region', { name: 'Состояние программы' });
  await expect(summary).toContainText('Нужны исправления');
  const data = await page.evaluate(
    () =>
      Object.values(JSON.parse(localStorage.getItem('courseos-demo-v1')!).courses)[0] as {
        snapshots: { audit: { issues: { blocking: boolean }[] } }[];
      },
  );
  const issues = data.snapshots.at(-1)!.audit.issues;
  await expect(summary.locator('dd').nth(0)).toHaveText(
    String(issues.filter((i) => i.blocking).length),
  );
  await expect(summary.locator('dd').nth(1)).toHaveText(
    String(issues.filter((i) => !i.blocking).length),
  );
  await expect(page.getByRole('tab', { name: `Замечания · ${issues.length}` })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.rationale-panel')).toBeHidden();
  expect(
    (await page.getByRole('button', { name: 'Разобрать замечания', exact: true }).boundingBox())!.y,
  ).toBeLessThan(650);
  await page.getByRole('tab', { name: /^Замечания/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Обоснования', exact: true })).toBeFocused();
  await expect(page.locator('.rationale-decision-list')).toBeVisible();
  await expect(page.locator('.review-panel')).toBeHidden();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Утверждение', exact: true })).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Утвердить программу', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Home');
  await page.locator('.review-issue-list button').first().press('Enter');
  const selectedId = await page.locator('.review-issue').getAttribute('id');
  await page.getByRole('link', { name: 'Перейти к исправлению', exact: true }).click();
  await expect(page.getByLabel('Дата начала', { exact: true })).toBeFocused();
  await page.getByRole('link', { name: 'Проверка и утверждение', exact: true }).click();
  await expect(page.locator('.review-issue')).toHaveAttribute('id', selectedId!);
  await expect(page.getByRole('tab', { name: /^Замечания/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.screenshot({ path: '../reports/review-navigation-blocking.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.review-issue')).toHaveAttribute('id', selectedId!);
});

test('No remarks, explicit approval, rationale filters and archived restrictions', async ({
  page,
}) => {
  await create(page);
  // Exercise the empty audit state independently of preset informational remarks.
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('courseos-demo-v1')!);
    for (const course of Object.values(db.courses) as {
      snapshots: { audit: { issues: unknown[] } }[];
    }[]) {
      course.snapshots.at(-1)!.audit.issues = [];
    }
    localStorage.setItem('courseos-demo-v1', JSON.stringify(db));
    sessionStorage.clear();
  });
  await page.reload();
  await expect(page.locator('.review-summary')).toContainText('Готово к утверждению');
  await expect(page.getByRole('tab', { name: 'Утверждение', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('button', { name: 'Утвердить программу', exact: true }),
  ).toBeDisabled();
  await page.getByRole('tab', { name: 'Обоснования', exact: true }).click();
  await page.getByLabel('Найти пояснение').fill('План');
  await expect(page.locator('.rationale-decision-list button').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await page.getByRole('checkbox', { name: /Я проверил цель/ }).check();
  await expect(page.locator('.review-summary')).toContainText('Готово к утверждению');
  await page.getByRole('button', { name: 'Утвердить программу', exact: true }).click();
  await expect(page.locator('.review-summary')).toContainText('Программа утверждена');
  await expect(page.getByRole('link', { name: 'Перейти к материалам', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Обоснования', exact: true }).click();
  await expect(page.getByLabel('Найти пояснение')).toHaveValue('План');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать пояснения · MD', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/rationale.md$/);
  await page.getByRole('link', { name: 'Перейти к материалам', exact: true }).click();
  await expect(page).toHaveURL(/\/materials/);
  const id = page.url().match(/courses\/([^/]+)/)![1];
  await page.goto(`/courses/${id}/plan?version=1#review`);
  await expect(page.getByRole('link', { name: 'К актуальной версии', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Утвердить программу', exact: true }),
  ).toBeDisabled();
});

test('Mobile lists, return focus, sticky actions and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page, true);
  await expect(page.locator('.review-issue-list')).toBeVisible();
  await expect(page.locator('.review-issue')).toBeHidden();
  await page.locator('.review-issue-list button').first().click();
  await expect(page.getByRole('button', { name: 'К списку замечаний', exact: true })).toBeVisible();
  await expect(page.locator('.review-issue-list')).toBeHidden();
  await page.getByRole('button', { name: 'К списку замечаний', exact: true }).click();
  await expect(page.locator('.review-issue-list button').first()).toBeFocused();
  await page.getByRole('tab', { name: 'Обоснования', exact: true }).click();
  await page.locator('.rationale-decision-list button').first().click();
  await expect(page.locator('.rationale-card')).toBeVisible();
  await page.getByRole('button', { name: 'К списку решений', exact: true }).click();
  await expect(page.locator('.rationale-decision-list button').first()).toBeFocused();
  await page.screenshot({ path: '../reports/review-navigation-mobile.png', fullPage: true });
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.rationale-decision-list button').first().click();
  await page.locator('.rationale-card details').evaluateAll((details) => {
    details.forEach((detail) => {
      (detail as HTMLDetailsElement).open = true;
    });
  });
  await page.evaluate(() => {
    const controls = document.querySelector('.review-controls')!;
    window.scrollTo(0, controls.getBoundingClientRect().top + window.scrollY + 100);
  });
  expect((await page.locator('.review-controls').boundingBox())!.y).toBeGreaterThanOrEqual(0);
  expect((await page.locator('.review-controls').boundingBox())!.y).toBeLessThan(80);
});
