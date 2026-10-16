import { answerDemoQuestions } from './answer-demo-questions';
import { test, expect } from '@playwright/test';

test('Editable programme lists support additions, removals and saving', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await answerDemoQuestions(page);
  await expect(page.locator('.verdict')).toBeVisible();
  await page.getByRole('link', { name: 'Учебный план', exact: true }).click();
  await page.getByRole('link', { name: 'О программе', exact: true }).click();
  await expect(page.locator('.intent-tasks .task-list')).toBeVisible();
  await expect(page.locator('.intent-tasks summary')).toHaveCount(0);
  await page.getByRole('button', { name: 'Изменить результаты обучения', exact: true }).click();
  const editor = page.locator('.intent-editor');
  const count = await editor.getByRole('textbox').count();
  await editor.getByRole('button', { name: 'Удалить результат 1', exact: true }).click();
  await editor.getByRole('button', { name: 'Добавить результат обучения', exact: true }).click();
  await editor
    .getByRole('textbox', { name: `Результат ${count}`, exact: true })
    .fill('Объясняет алгоритм на примере');
  await editor.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.outcomes')).toContainText('Объясняет алгоритм на примере');
  await page.getByRole('button', { name: 'Изменить задачи программы', exact: true }).click();
  const taskCount = await editor.getByRole('textbox').count();
  await editor.getByRole('button', { name: 'Удалить задачу 1', exact: true }).click();
  await editor.getByRole('button', { name: 'Добавить задачу', exact: true }).click();
  await editor
    .getByRole('textbox', { name: `Задача ${taskCount}`, exact: true })
    .fill('Разобрать алгоритм');
  await editor.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.intent-tasks')).toContainText('Разобрать алгоритм');
  await page.getByRole('link', { name: 'Учебный план', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить план', exact: true }).click();
  const topics = page.locator('.skeleton-topics-editor tbody tr');
  const topicCount = await topics.count();
  await page.getByRole('button', { name: 'Добавить тему', exact: true }).click();
  await expect(topics).toHaveCount(topicCount + 1);
  await page
    .getByRole('textbox', { name: `Название темы ${topicCount + 1}`, exact: true })
    .fill('Новая тема');
  await page.getByRole('button', { name: `Удалить тему ${topicCount + 1}`, exact: true }).click();
  await expect(topics).toHaveCount(topicCount);
});
