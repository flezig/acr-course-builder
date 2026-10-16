import { expect, test } from '@playwright/test';
import { presets } from '../src/entities/course/model/presets';
import { demoClarifications } from '../src/entities/course/model/demo-clarifications';
import { chooseRecommendedAnswers } from './answer-demo-questions';

for (const preset of presets) {
  test(`${preset.label}: агент уточняет содержание до построения структуры`, async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: `${preset.label} ${preset.description}`, exact: true })
      .click();
    await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Агент уточняет', exact: true })).toBeVisible();
    const submit = page.getByRole('button', { name: 'Сохранить ответы и построить программу' });
    await expect(submit).toBeDisabled();
    await expect(page.locator('.verdict')).toHaveCount(0);
    for (const question of demoClarifications[preset.id]) {
      await expect(page.getByRole('combobox', { name: question.label, exact: true })).toBeVisible();
      await expect(page.getByText(question.reason, { exact: true })).toBeVisible();
      await expect(
        page.getByRole('option', {
          name: `${question.recommended} — предлагает агент`,
          exact: true,
        }),
      ).toHaveCount(1);
    }
    await page.reload();
    await chooseRecommendedAnswers(page);
    const question = demoClarifications[preset.id][0];
    const customAnswer = `Учебный вариант для ${preset.label}`;
    const customField = page.getByLabel(`Свой вариант: ${question.label}`, { exact: true });
    // Поле своего ответа появляется только после выбора «Свой вариант».
    await expect(customField).toHaveCount(0);
    await page.getByRole('combobox', { name: question.label, exact: true }).selectOption('custom');
    await customField.fill('   ');
    await expect(submit).toBeDisabled();
    await customField.fill(customAnswer);
    if (preset.id === 'security') {
      await page
        .getByLabel('Какой тип программы нужен?', { exact: true })
        .selectOption('acr_general');
      await page.getByLabel('Какой объём в часах?', { exact: true }).fill('72');
      await page
        .getByLabel('Какой входной уровень слушателей?', { exact: true })
        .fill('Основы работы с компьютером');
      await page.getByLabel('В какой форме проходит обучение?', { exact: true }).fill('Очно');
      await page
        .getByLabel('Какая итоговая аттестация предусмотрена?', { exact: true })
        .fill('Проект');
    }
    await submit.click();
    await expect(page.locator('.verdict')).toBeVisible();
    await page.getByRole('link', { name: 'Учебный план', exact: true }).click();
    await expect(page.locator('main')).toContainText(customAnswer);
    await page.reload();
    await expect(page.locator('main')).toContainText(customAnswer);
    const saved = await page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => key.includes('demo'))
        .map(([, value]) => value)
        .join('\n'),
    );
    expect(saved).toContain(question.label);
    expect(saved).toContain(customAnswer);
    await page.getByRole('link', { name: 'Решения', exact: true }).click();
    await page.getByRole('tab', { name: 'Обоснования', exact: true }).click();
    await page.getByRole('button', { name: 'Темы и порядок', exact: true }).click();
    await page.locator(`[data-decision-id="topic-${question.topic}"]`).click();
    const rationale = page.locator(`[id="basis-topic-${question.topic}"]`);
    await expect(rationale).toContainText(question.label);
    await expect(rationale).toContainText(customAnswer);
    await expect(rationale).toContainText(question.reason);
  });
}

test('изменённый собственный запрос не получает вопросы выбранного ранее примера', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Первые шаги в Python/ }).click();
  const request = page.getByLabel('Запрос методиста');
  await request.fill((await request.inputValue()) + ' Особое внимание работе со строками.');
  await page.locator('.parameter-summary > summary').click();
  await page
    .getByRole('checkbox', { name: 'Подтверждаю параметры изменённого запроса вручную' })
    .check();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.verdict')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Агент уточняет', exact: true })).toHaveCount(0);
});
