import { expect, type Page } from '@playwright/test';

export async function chooseRecommendedAnswers(page: Page) {
  const questions = page.locator('.clarification-question');
  await expect(questions.first()).toBeVisible();
  for (const question of await questions.all()) {
    const option = question.locator('option').filter({ hasText: 'предлагает агент' });
    await question.getByRole('combobox').selectOption((await option.getAttribute('value'))!);
  }
}

export async function answerDemoQuestions(page: Page) {
  const heading = page.getByRole('heading', { name: 'Агент уточняет', exact: true });
  await expect(heading.or(page.locator('.verdict')).first()).toBeVisible();
  if (!(await heading.isVisible())) return;
  await chooseRecommendedAnswers(page);
  await page.getByRole('button', { name: 'Сохранить ответы и построить программу' }).click();
}
