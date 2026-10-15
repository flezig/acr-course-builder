import { test, expect, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function contents(download: Download) {
  return readFile((await download.path())!, 'utf8');
}
test('Основания в интерфейсе, JSON и MD относятся к одной версии; архив неизменен', async ({
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
  await expect(page.locator('.goal-statement')).toBeVisible();
  const id = page.url().match(/courses\/([^/]+)/)![1];
  const stored = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem('courseos-demo-v1')!).courses[id].snapshots.at(-1),
    id,
  );
  await expect(page.locator('#why-hours > summary')).toContainText(
    stored.skeleton.explanations.find((e: { id: string }) => e.id === 'why-hours').conclusion,
  );
  await page.locator('#why-hours > summary').click();
  await page.locator('#why-hours .evidence-block').first().locator('summary').click();
  await expect(page.locator('#why-hours pre')).toHaveText(
    stored.skeleton.explanations
      .find((e: { id: string }) => e.id === 'why-hours')
      .detail.replace(/(\d) ч(?=[\s.,]|$)/g, '$1 уч. ч.'),
  );
  await page.getByRole('link', { name: 'Проверка и утверждение', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Почему курс устроен так' })).toBeVisible();
  await page.getByRole('button', { name: /^Практика/ }).click();
  await page.getByLabel('Выберите решение', { exact: true }).selectOption('activity-topic-4');
  const basis = page.locator('[id="basis-activity-topic-4"]');
  await basis.getByText('Источники и подробности', { exact: false }).click();
  await expect(basis).toContainText('Примеры с подцелями');
  await expect(basis).toContainText('Подтверждено частично');
  await expect(basis).toContainText(
    'Этого пока недостаточно, чтобы считать решение проверенным для вашей группы.',
  );
  const oldDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать пояснения · MD', exact: true }).click();
  const old = await contents(await oldDownload);
  expect(old).toContain(stored.skeleton_hash);
  await page.getByRole('checkbox', { name: /Я проверил цель/ }).check();
  await page.getByRole('button', { name: 'Утвердить каркас', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Проверить материалы', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.goto(`/courses/${id}/materials?tab=exports`);
  await expect(page.getByRole('button', { name: 'Скачать MD', exact: true })).toBeVisible();
  const mdDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать MD', exact: true }).click();
  const md = await contents(await mdDownload);
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать JSON', exact: true }).click();
  const json = JSON.parse(await contents(await jsonDownload));
  expect(md).toContain(json.skeleton_hash);
  expect(md).toContain(`Версия курса: ${json.course_version}`);
  await page.goto(`/courses/${id}/plan#intent`);
  await page
    .getByRole('button', { name: 'Изменить аудиторию и входной уровень', exact: true })
    .click();
  await page.getByLabel('Аудитория', { exact: true }).fill('Взрослые слушатели');
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(page.locator('.save-feedback')).toBeVisible();
  await page.getByRole('link', { name: 'Проверка и утверждение', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Утвердить каркас', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Цель и участники/ }).click();
  await page.getByLabel('Выберите решение', { exact: true }).selectOption('goal');
  await expect(page.locator('[id="basis-goal"]')).toContainText('Проверить заново');
  await page.goto(`/courses/${id}/plan?version=${stored.course_version}#review`);
  const archiveDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать пояснения · MD', exact: true }).click();
  expect(await contents(await archiveDownload)).toBe(old);
  await page.screenshot({ path: '../reports/rationale-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Открыть навигацию', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '../reports/rationale-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});
