import { answerDemoQuestions } from './answer-demo-questions';
import { test, expect, type Page } from '@playwright/test';

// Скриншоты для сравнения «до/после» переделки карточки программы.
// Этап задаётся через COURSEOS_SHOT_STAGE, чтобы один сценарий снимал обе серии.
const stage = process.env.COURSEOS_SHOT_STAGE || 'after';
const bank = 'Анализ данных на Python 72 часа · сотрудники банков · повышение квалификации';
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

async function createBank(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: bank, exact: true }).click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await answerDemoQuestions(page);
  await expect(page.locator('.course-heading h1')).toHaveText('Анализ данных на Python');
}

for (const viewport of viewports)
  test(`Скриншоты карточки, учебного плана и проверки: ${stage}, ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await createBank(page);
    const shot = (screen: string) =>
      page.screenshot({
        path: `../reports/decision-redesign/${stage}-${screen}-${viewport.name}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    await shot('program-card');
    await page.goto(`${page.url().split('#')[0]}#curriculum`);
    await expect(page.locator('#curriculum table').first()).toBeVisible();
    await shot('curriculum');
    // Очереди решений до переделки не было: снимок есть только в серии «после».
    if (stage === 'after') {
      await page.goto(`${page.url().split('#')[0]}#review`);
      await expect(page.locator('.decision-queue')).toBeVisible();
      await shot('decisions');
    }
    await page.goto(page.url().replace(/\/plan.*$/, '/audit'));
    await expect(page.locator('h1')).toBeVisible();
    await shot('audit');
  });
