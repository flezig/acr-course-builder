import { test, expect } from '@playwright/test';

test('Conflict details are visible without opening nested evidence', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'DevOps: Linux → CI/CD 256 часов · стажировка · календарный конфликт',
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  const explanation = page.locator('#why-conflicts');
  await explanation.locator(':scope > summary').click();
  await expect(
    explanation.getByRole('heading', { name: 'Не хватает данных о календаре' }),
  ).toBeVisible();
  await expect(explanation.getByText('Требование:', { exact: true })).toBeVisible();
  await explanation.getByRole('link', { name: 'Календарь', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить календарь' }).click();
  await page.getByRole('radio', { name: /Сохранить текущий календарь/ }).check();
  await page
    .getByRole('checkbox', {
      name: 'Подтверждаю сохранение календаря с нехваткой часов',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Применить и пересчитать' }).click();
  await page.getByRole('link', { name: 'Замысел', exact: true }).click();
  if ((await explanation.getAttribute('open')) === null)
    await explanation.locator(':scope > summary').click();
  const conflict = explanation.locator('section.evidence-block');
  await expect(conflict).toContainText('Доступно 56 дней; дефицит 32 часа');
  await expect(conflict.getByText(/ceil\(256 \/ 4\) = 64/)).toBeVisible();
  await expect(conflict).toContainText(
    'Продлить календарь; Сократить объём; Изменить дневной лимит',
  );
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(conflict).toBeVisible();
    await conflict.scrollIntoViewIfNeeded();
    const bounds = await conflict.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await conflict.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await conflict.screenshot({ path: `../reports/conflict-explanation-${width}.png` });
  }
});
