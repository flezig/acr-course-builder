import { test, expect } from '@playwright/test';

test('navigation fits laptop and phone heights; theme survives reload and navigation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'ИИ в работе учителя 36 часов · учителя · повышение квалификации',
    })
    .click();
  await page
    .getByLabel('Название / ИТ-тема')
    .fill(
      'Искусственный интеллект в профессиональной деятельности учителя: проектирование образовательных материалов и проверка результатов обучения',
    );
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.verdict')).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1280, 600],
    [1024, 560],
    [390, 667],
  ]) {
    await page.setViewportSize({ width, height });
    if (width <= 800) await page.getByRole('button', { name: 'Открыть навигацию' }).click();
    const sidebar = page.locator('.sidebar');
    expect(
      await sidebar.evaluate((element) => element.scrollHeight - element.clientHeight),
    ).toBeLessThanOrEqual(1);
    const lastLink = page.getByRole('link', { name: 'Сравнение версий', exact: true });
    await expect(lastLink).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    if (width <= 800) await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Включить тёмную тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Включить светлую тему' })).toBeVisible();
  for (const name of [
    'Карта результатов',
    'Материалы и выгрузки',
    'Проверка программы',
    'Сравнение версий',
  ]) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const background = await page
      .locator('.sidebar')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(background).toBe('rgb(16, 16, 16)');
  }
  await page.getByRole('button', { name: 'Включить светлую тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Включить тёмную тему' })).toBeVisible();
  expect(errors).toEqual([]);
});
