import { test, expect } from '@playwright/test';

test('Plan editor keeps content readable and outcome links consistent after additions and removals', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.verdict')).toBeVisible();
  await page.getByRole('link', { name: 'Учебный план', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить план', exact: true }).click();
  const editor = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Сохранить новую версию' }) });
  await expect(editor).not.toContainText(/outcome-|assessment-|activity-|mentor_interview/);
  const count = await editor.locator('.outcome-editor').count();
  await page.getByRole('button', { name: 'Добавить результат обучения', exact: true }).click();
  await page
    .getByRole('textbox', { name: `Результат ${count + 1}`, exact: true })
    .fill('Объяснять работу алгоритма на примере');
  const topicResults = page.getByLabel('Результаты темы 1', { exact: true });
  await topicResults.locator('summary').click();
  await topicResults
    .getByRole('checkbox', { name: 'Объяснять работу алгоритма на примере' })
    .check();
  await topicResults.locator('summary').click();
  await expect(topicResults.locator('summary')).toContainText('Выбрано результатов:');
  await page.getByText('Оценочные материалы', { exact: true }).click();
  const assessmentResults = page
    .getByLabel('Проверяемые результаты обучения (можно выбрать несколько)')
    .first();
  await expect(assessmentResults.getByRole('checkbox').first()).toBeHidden();
  await assessmentResults.locator('summary').click();
  await assessmentResults.getByRole('checkbox').first().check();
  await assessmentResults
    .getByRole('checkbox', { name: 'Объяснять работу алгоритма на примере' })
    .check();
  await assessmentResults.locator('summary').click();
  await assessmentResults.locator('summary').press('Enter');
  expect(await assessmentResults.locator('input:checked').count()).toBeGreaterThan(1);
  await expect(
    assessmentResults.getByRole('checkbox', { name: 'Объяснять работу алгоритма на примере' }),
  ).toBeChecked();
  await expect(editor).not.toContainText(/assessment-| · project| · test/);
  await page.getByRole('button', { name: `Удалить результат ${count + 1}`, exact: true }).click();
  await expect(
    topicResults.getByRole('checkbox', { name: 'Объяснять работу алгоритма на примере' }),
  ).toHaveCount(0);
  await expect(
    assessmentResults.getByRole('checkbox', { name: 'Объяснять работу алгоритма на примере' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Добавить оценочное средство', exact: true }).click();
  const addedAssessment = page.locator('.assessment-plan-editor .assessment-editor').last();
  await expect(addedAssessment).toContainText('Проект');
  await addedAssessment.getByRole('button', { name: 'Удалить оценочное средство' }).click();
  await page
    .locator('.assessment-plan-editor')
    .screenshot({ path: '/tmp/courseos-assessment-picker.png' });
  const content = page.getByRole('textbox', { name: 'Содержание темы 1', exact: true });
  await content.fill('Подробное объяснение темы с примерами и упражнениями. '.repeat(40));
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await content.evaluate((el) => el.scrollHeight <= el.clientHeight + 2)).toBe(true);
    expect(
      await page.locator('.skeleton-topics-editor').evaluate((el) => ({
        height: el.scrollHeight - el.clientHeight,
        width: el.scrollWidth - el.clientWidth,
      })),
    ).toEqual({ height: 0, width: 0 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Добавить результат обучения', exact: true }).click();
  await page
    .getByRole('textbox', { name: `Результат ${count + 1}`, exact: true })
    .fill('Находить ошибку в учебной программе');
  await page.getByRole('button', { name: 'Сохранить новую версию', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Изменить план', exact: true }).click();
  await expect(content).toHaveValue(
    'Подробное объяснение темы с примерами и упражнениями. '.repeat(40),
  );
  await expect(page.locator('.outcome-editor')).toHaveCount(count + 1);
  await expect(
    page.getByRole('textbox', { name: `Результат ${count + 1}`, exact: true }),
  ).toHaveValue('Находить ошибку в учебной программе');
});
