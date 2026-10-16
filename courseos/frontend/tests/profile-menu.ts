import type { Page } from '@playwright/test';

// Тема, настройки и вход живут в меню профиля внизу боковой навигации.
export async function openProfileMenu(page: Page) {
  const menu = page.locator('.profile-menu');
  // На узком экране навигация спрятана в выдвижную панель.
  const openNavigation = page.getByRole('button', { name: 'Открыть навигацию' });
  if (await openNavigation.isVisible()) await openNavigation.click();
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
}

export async function openSettings(page: Page) {
  await openProfileMenu(page);
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
}
