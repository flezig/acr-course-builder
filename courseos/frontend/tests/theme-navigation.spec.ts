import { answerDemoQuestions } from './answer-demo-questions';
import { test, expect } from '@playwright/test';
import { editDraft } from './create-draft';
import { openProfileMenu } from './profile-menu';

test('шапка проверки помещается в окно с обеими темами', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Первые шаги в Python/ }).click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await answerDemoQuestions(page);
  await expect(page.locator('.verdict')).toBeVisible();
  await page.getByRole('link', { name: 'Проверка программы', exact: true }).click();
  const heading = page.locator('.heading-action');
  await expect(heading.getByRole('heading', { name: 'Проверка программы' })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await openProfileMenu(page);
      await page.getByRole('button', { name: 'Включить тёмную тему' }).click();
    }
    for (const width of [1920, 1440, 1280, 1024, 820, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `${theme}, ${width} px: страница не должна расширять окно`,
      ).toBeLessThanOrEqual(width);
      for (const action of [
        heading.getByRole('button', { name: 'Повторить проверку' }),
        heading.getByRole('link', { name: 'Материалы и выгрузки' }),
      ]) {
        await expect(action).toBeVisible();
        const bounds = await action.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
    }
  }
});

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
  await editDraft(
    page,
    (draft) =>
      (draft.title =
        'Искусственный интеллект в профессиональной деятельности учителя: проектирование образовательных материалов и проверка результатов обучения'),
  );
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await answerDemoQuestions(page);
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
    // У новой программы одна версия, поэтому пункта сравнения нет и последний пункт — материалы.
    const navigation = page.getByRole('navigation', { name: 'Экраны программы' });
    await expect(navigation.getByRole('link', { name: 'Сравнение версий' })).toHaveCount(0);
    await expect(
      navigation.getByRole('link', { name: 'Материалы и выгрузки', exact: true }),
    ).toBeInViewport();
    // Через профиль открываются настройки и тема, поэтому он тоже должен помещаться.
    await expect(page.locator('.profile-menu summary')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    if (width <= 800) await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await openProfileMenu(page);
  await page.getByRole('button', { name: 'Включить тёмную тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await openProfileMenu(page);
  await expect(page.getByRole('button', { name: 'Включить светлую тему' })).toBeVisible();
  for (const name of ['Карта результатов', 'Проверка программы', 'Материалы и выгрузки']) {
    // На странице проверки есть одноимённая кнопка-ссылка, поэтому ищем в боковой навигации.
    await page
      .getByRole('navigation', { name: 'Экраны программы' })
      .getByRole('link', { name, exact: true })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const background = await page
      .locator('.sidebar')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(background).toBe('rgb(16, 22, 34)');
  }
  await openProfileMenu(page);
  await page.getByRole('button', { name: 'Включить светлую тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await openProfileMenu(page);
  await expect(page.getByRole('button', { name: 'Включить тёмную тему' })).toBeVisible();
  expect(errors).toEqual([]);
});
