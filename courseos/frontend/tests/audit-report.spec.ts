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
    const planUrl = page.url().split('#')[0];
    const banner = page.getByRole('region', { name: 'Решение по программе' });
    const heading = await banner.locator('h2').innerText();
    const firstLink = banner.locator('.verdict-issue-link').first();
    const issueHash = await firstLink.getAttribute('href');
    await firstLink.click();
    const issueId = issueHash!.split('#')[1];
    await expect(page.locator(`[id="${issueId}"]`)).toBeInViewport();
    await page.goto(planUrl.replace(/\/plan.*$/, `/audit#${issueId}`));
    await expect(page.getByRole('link', { name: 'Находки аудита', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator(`[id="${issueId}"]`)).toBeInViewport();
    const blockers = heading.match(/\d+/)?.[0];
    await expect(
      page.getByText(`Блокируют утверждение: ${blockers}`, { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Чек-лист', exact: true }).click();
    await expect(page.getByText('Профстандарт и его код существуют', { exact: true })).toHaveCount(
      1,
    );
    await expect(
      page.locator('.checklist-item').filter({ hasText: 'Профстандарт и его код существуют' }),
    ).toContainText('Проблема');
  });
}

test('ссылка очереди на неизвестный элемент открывает точную находку в отчёте', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Анализ данных на Python/ }).click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.course-heading h1')).toBeVisible();
  await page.goto(`${page.url().split('#')[0]}#review`);
  // Проверка оснований адресуется элементу goal, для которого очередь использует переход в отчёт.
  const reportLink = page.locator('.decision-queue a[href*="/audit#issue-"]').first();
  await expect(reportLink).toBeVisible();
  const href = await reportLink.getAttribute('href');
  await reportLink.click();
  await expect(page.locator(`[id="${href!.split('#')[1]}"]`)).toBeInViewport();
});
