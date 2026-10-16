import { test, expect } from '@playwright/test';

for (const scenario of [
  'ИИ в работе учителя',
  'Анализ данных на Python',
  'DevOps: Linux → CI/CD',
]) {
  test(`${scenario}: отчёт, блокеры и переходы к находкам`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(scenario) }).click();
    await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
    await expect(page.locator('.course-heading h1')).toBeVisible();
    const banner = page.getByRole('region', { name: 'Решение по программе' });
    const heading = await banner.locator('h2').innerText();
    const firstLink = banner.locator('.verdict-issue-link').first();
    const issueHash = await firstLink.getAttribute('href');
    await firstLink.click();
    const issueId = issueHash!.split('#')[1];
    await expect(page.locator(`[id="${issueId}"]`)).toBeInViewport();
    await page.reload();
    await expect(page.locator(`[id="${issueId}"]`)).toBeFocused();
    const blockers = heading.match(/\d+/)?.[0];
    await page.getByRole('link', { name: 'Проверка программы', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Проверка программы', exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.notice').filter({ hasText: `Блокируют утверждение: ${blockers}` }),
    ).toBeVisible();
    await expect(page.getByText('Профстандарт и его код существуют', { exact: true })).toHaveCount(
      1,
    );
    await expect(
      page.locator('.checklist-item').filter({ hasText: 'Профстандарт и его код существуют' }),
    ).toContainText('Проблема');
  });
}

test('ссылка очереди на основание оставляет доступ к пояснениям программы', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Анализ данных на Python/ }).click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.course-heading h1')).toBeVisible();
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('courseos-demo-v1')!);
    const course = Object.values(stored.courses)[0] as {
      snapshots: { audit: { issues: Record<string, unknown>[] } }[];
    };
    const issues = course.snapshots.at(-1)!.audit.issues;
    issues.push({
      ...issues[0],
      id: 'goal-basis',
      element_id: 'goal',
      message: 'Основание цели требует проверки',
      blocking: false,
      fix: undefined,
    });
    localStorage.setItem('courseos-demo-v1', JSON.stringify(stored));
  });
  await page.reload();
  await page.getByRole('link', { name: 'Решения и утверждение', exact: true }).click();
  const basisLink = page
    .locator('#issue-goal-basis')
    .getByRole('link', { name: 'Открыть место в программе' });
  await expect(basisLink).toBeVisible();
  await basisLink.click();
  await expect(page).toHaveURL(/\/plan#review$/);
  await page.getByRole('tab', { name: 'Обоснования', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Почему курс устроен так', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.rationale-decision-list button').first()).toBeVisible();
});
