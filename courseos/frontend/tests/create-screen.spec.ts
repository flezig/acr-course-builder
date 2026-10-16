import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { presets } from '../src/entities/course/model/presets';

for (const [width, height] of [
  [1440, 900],
  [768, 1024],
  [390, 844],
  [360, 800],
]) {
  test(`Start screen and all five examples at ${width}×${height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.locator('.parameter-summary')).not.toHaveAttribute('open');
    await expect(page.getByRole('button', { name: 'Добавить материалы' })).toBeVisible();
    const submit = page.getByRole('button', { name: 'Отправить запрос', exact: true });
    await expect(page.getByLabel('Запрос методиста')).toBeInViewport({ ratio: 1 });
    const request = await page.getByLabel('Запрос методиста').boundingBox();
    const upload = await page.locator('.attachment-trigger').boundingBox();
    const submitBounds = await submit.boundingBox();
    expect(upload!.y).toBeGreaterThanOrEqual(request!.y + request!.height);
    expect(submitBounds!.y).toBeGreaterThanOrEqual(upload!.y + upload!.height);
    await expect(page.getByText('Сначала структура программы', { exact: true })).toHaveCount(0);
    await expect(page.getByText('ОБРАЗЕЦ АЦР', { exact: true })).toHaveCount(0);
    if (width > 1000) {
      await expect(page.locator('.example').last()).toBeInViewport({ ratio: 1 });
      const heading = await page.locator('.create-heading').boundingBox();
      expect(heading!.height).toBeLessThan(140);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await expect(page.locator('.example')).toHaveCount(5);
    await expect(page.getByRole('heading', { name: 'Создайте учебную программу' })).toBeVisible();
    await expect(page.locator('.topbar .badge')).toHaveText('Демо-режим');
    await expect(page.locator('.example-topic')).toHaveText(['PY', 'ИИ', 'DATA', 'SEC', 'OPS']);
    const layout = await page.evaluate(() => {
      const heading = document.querySelector('.create-heading')!;
      const arc = getComputedStyle(heading, '::after');
      const examples = [...document.querySelectorAll('.example')];
      return {
        arcDiameter: parseFloat(arc.width),
        arcRight: parseFloat(arc.right),
        arcBottom: parseFloat(arc.top) + parseFloat(arc.height),
        headingPadding: parseFloat(getComputedStyle(heading).paddingTop),
        descriptionTop:
          document.querySelector('.create-heading p')!.getBoundingClientRect().top -
          heading.getBoundingClientRect().top,
        titleRight:
          document.querySelector('.create-heading h1')!.getBoundingClientRect().right -
          parseFloat(getComputedStyle(document.querySelector('.create-heading h1')!).paddingRight),
        arcLeft:
          heading.getBoundingClientRect().right - parseFloat(arc.right) - parseFloat(arc.width),
        examples: examples.map((e) => ({
          x: e.getBoundingClientRect().x,
          height: e.getBoundingClientRect().height,
        })),
        clipped: [
          ...document.querySelectorAll(
            '.create-workspace strong, .create-workspace small, .create-workspace p, .topbar .badge',
          ),
        ]
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map((e) => e.textContent),
      };
    });
    expect(layout.clipped).toEqual([]);
    expect(layout.arcBottom).toBeLessThanOrEqual(layout.descriptionTop);
    if (width <= 600) {
      // В светлой теме шапку украшает волна шириной 220 px.
      expect(layout.arcDiameter).toBe(220);
      expect(layout.arcRight).toBe(0);
      expect(layout.arcBottom).toBeLessThan(layout.descriptionTop);
      expect(new Set(layout.examples.map((e) => e.x)).size).toBe(1);
      expect(layout.examples.every((e) => e.height >= 48)).toBe(true);
    }
    for (const preset of presets) {
      const example = page.getByRole('button', {
        name: `${preset.label} ${preset.description}`,
        exact: true,
      });
      await example.click();
      await expect(example).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.example[aria-pressed="true"]')).toHaveCount(1);
      await expect(page.getByLabel('Запрос методиста')).toHaveValue(preset.requirements.request);
      await expect(page.getByLabel('Профстандарт программы')).toHaveValue(
        preset.id === 'python' ? '' : preset.id,
      );
      await expect(page).toHaveURL(/\/$/); // Selecting an example must not submit it.
    }
    const first = page.locator('.example').first();
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(await first.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    await page.getByLabel('Запрос методиста').fill('Моя программа с изменённой темой');
    await page.reload();
    await expect(page.getByLabel('Запрос методиста')).toHaveValue(
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
  await expect(page.getByRole('heading', { name: 'Агент уточняет' })).toBeVisible();
});

test('Empty form keeps validation and does not submit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.getByLabel('Запрос методиста')).toBeFocused();
  await expect(page.getByLabel('Запрос методиста')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/$/);
});
