import type { Page } from '@playwright/test';

// Готовим черновик до загрузки формы, затем явно подтверждаем его параметры в деморежиме.
export async function editDraft(page: Page, patch: (draft: Record<string, any>) => void) {
  const request = page.getByLabel('Запрос методиста');
  await request.fill(await request.inputValue());
  const key = await page.evaluate(() =>
    Object.keys(localStorage).find((k) => k.startsWith('courseos-create-draft-')),
  );
  const draft = JSON.parse(await page.evaluate((k) => localStorage.getItem(k!)!, key));
  patch(draft);
  await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [key, JSON.stringify(draft)]);
  await page.reload();
  await page
    .getByRole('checkbox', { name: 'Подтверждаю параметры изменённого запроса вручную' })
    .check();
}
