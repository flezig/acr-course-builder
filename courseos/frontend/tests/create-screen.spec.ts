import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { presets } from '../src/entities/course/model/presets';

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
  [390, 844],
  [375, 667],
]) {
  test(`Start screen and all five examples at ${width}×${height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const submit = page.getByRole('button', { name: 'Отправить запрос', exact: true });
    await expect(page.getByLabel('Запрос методиста')).toBeInViewport({ ratio: 1 });
    await expect(submit).toBeInViewport({ ratio: 1 });
    const bounds = await submit.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    if (width > 1000) {
      await expect(page.locator('.example').last()).toBeInViewport({ ratio: 1 });
      const heading = await page.locator('.create-heading').boundingBox();
      expect(heading!.height).toBeLessThan(140);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await expect(page.locator('.example')).toHaveCount(5);
    for (const preset of presets) {
      const example = page.getByRole('button', {
        name: `${preset.label} ${preset.description}`,
        exact: true,
      });
      await example.click();
      await expect(example).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.example[aria-pressed="true"]')).toHaveCount(1);
      // Check the complete original payload, including dates, flags and empty values.
      const fields = await page
        .locator('.create-layout')
        .evaluate((form) =>
          Object.fromEntries(
            Array.from(
              form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
                'input[name], select[name], textarea[name]',
              ),
            ).map((field) => [
              field.name,
              field instanceof HTMLInputElement && field.type === 'checkbox'
                ? field.checked
                : field.value,
            ]),
          ),
        );
      for (const [key, value] of Object.entries(preset.requirements)) {
        if (key === 'references') continue;
        if (key === 'calendar') {
          for (const [name, expected] of Object.entries(preset.requirements.calendar)) {
            expect(fields[`calendar.${name}`]).toBe(
              typeof expected === 'boolean' ? expected : String(expected),
            );
          }
        } else expect(fields[key]).toBe(value);
      }
      await expect(page).toHaveURL(/\/$/); // Selecting an example must not submit it.
    }
    const first = page.locator('.example').first();
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(await first.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    await page.getByLabel('Название / ИТ-тема').fill('Моя программа с изменённой темой');
    await page.reload();
    await expect(page.getByLabel('Название / ИТ-тема')).toHaveValue(
      'Моя программа с изменённой темой',
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await mkdir(path.resolve('../reports'), { recursive: true });
    await page.screenshot({
      path: path.resolve(`../reports/create-screen-${width}x${height}.png`),
    });
    expect(errors).toEqual([]);
  });
}

test('Submit preserves the incomplete request and opens existing clarification step', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Кибербезопасность Неполный запрос/ }).click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Уточните 5 параметров' })).toBeVisible();
});
