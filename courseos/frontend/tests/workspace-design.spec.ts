import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { editDraft } from './create-draft';

test('Course OS: замечания, версии и адаптивность 1440/1280/768/390', async ({ page }) => {
  const reports = path.resolve('../reports/workspace-redesign');
  await mkdir(reports, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'ИИ в работе учителя 36 часов · учителя · повышение квалификации',
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.verdict')).toBeVisible();
  const planUrl = page.url();
  const status = page.locator('.verdict');
  await expect(status.locator('h2')).toHaveText('Блокируют утверждение: 2');
  await page.getByRole('link', { name: 'Решения и утверждение', exact: true }).click();
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Утвердить программу', exact: true }),
  ).toBeDisabled();
  await page.getByRole('link', { name: 'О программе', exact: true }).click();
  const measurements = [];
  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(reports, `plan-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await page.screenshot({
      path: path.join(reports, `viewport-${width}.png`),
      animations: 'disabled',
    });
    const geometry = await page.evaluate(() => {
      const title = document.querySelector('h1')!;
      const bounds = title.getBoundingClientRect();
      return {
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        titleFont: getComputedStyle(title).fontSize,
        titleWidth: bounds.width,
        sidebar: getComputedStyle(document.querySelector('.sidebar')!).width,
      };
    });
    measurements.push(geometry);
    expect(geometry.document).toBeLessThanOrEqual(width);
    // У нового курса одна версия, поэтому выбирать версию не из чего.
    await expect(page.getByLabel('Версия курса')).toHaveCount(0);
    await expect(status.getByRole('link', { name: 'К первому вопросу' })).toBeVisible();
    if (width <= 800) {
      await page.getByRole('button', { name: 'Открыть навигацию' }).click();
      await expect(page.getByRole('dialog', { name: 'Навигация CourseOS' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Открыть навигацию' })).toBeFocused();
    }
  }
  await status.getByRole('link', { name: 'К первому вопросу' }).click();
  const issueId = decodeURIComponent(new URL(page.url()).hash.slice(1));
  await expect(page.locator(`[id="${issueId}"]`)).toBeVisible();
  await expect(page.locator(`[id="${issueId}"]`)).toBeFocused();
  await page.goto(planUrl);
  await page.getByRole('link', { name: 'Решения и утверждение', exact: true }).click();
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  // Операция создания уже завершена, поэтому журнал операций в утверждении не показывается.
  await expect(page.getByText('Журнал операций', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'О программе', exact: true }).click();
  await page.locator('.explanation summary').first().click();
  await expect(page.locator('.explanation').first()).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Редактировать программу' }).click();
  await expect(page.getByRole('heading', { name: 'Редактирование программы' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await page.getByRole('button', { name: 'Редактировать программу' }).click();
  await page.getByRole('textbox', { name: 'Цель', exact: true }).fill('Уточнённая цель обучения');
  await page.getByRole('button', { name: 'Сохранить новую ревизию' }).click();
  await expect(page.getByRole('heading', { name: 'Редактирование программы' })).toHaveCount(0);
  await page.getByLabel('Версия курса').selectOption('1');
  await expect(page.getByRole('button', { name: 'Редактировать программу' })).toBeDisabled();
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'ИИ в работе учителя 36 часов · учителя · повышение квалификации',
    })
    .click();
  const longTitle =
    'Искусственный интеллект в профессиональной деятельности учителя: проектирование образовательных материалов и проверка результатов обучения';
  await editDraft(page, (draft) => (draft.title = longTitle));
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.getByRole('heading', { name: longTitle, exact: true })).toBeVisible();
  await expect(page.locator('.verdict')).toBeVisible();
  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole('heading', { name: longTitle, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({
      path: path.join(reports, `long-title-${width}.png`),
      animations: 'disabled',
    });
    if (width <= 800) await page.getByRole('button', { name: 'Открыть навигацию' }).click();
    const program = page.locator('.program-trigger > span');
    await expect(program).toHaveText(longTitle);
    await expect(program).toHaveAttribute('title', longTitle);
    await expect(program).toHaveCSS('-webkit-line-clamp', '2');
    await expect(program).toHaveCSS('overflow', 'hidden');
    if (width <= 800) await page.getByRole('button', { name: 'Закрыть навигацию' }).click();
  }
  expect(errors).toEqual([]);
  await writeFile(path.join(reports, 'measurements.json'), JSON.stringify(measurements, null, 2));
});
