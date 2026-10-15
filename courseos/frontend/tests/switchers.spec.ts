import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`Sidebar menus dismiss outside and preserve inside clicks (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    if (mobile) await page.getByRole('button', { name: 'Открыть навигацию' }).click();
    const program = page.locator('.program-switcher');
    const workspace = page.locator('.workspace-switcher');

    await program.locator('summary').click();
    await expect(program).toHaveAttribute('open', '');
    await program.locator('.program-options').click();
    await expect(program).toHaveAttribute('open', '');
    await workspace.locator('summary').click();
    await expect(program).not.toHaveAttribute('open');
    await expect(workspace).toHaveAttribute('open', '');
    await workspace.locator('.workspace-current').click();
    await expect(workspace).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(workspace).not.toHaveAttribute('open');
    await expect(workspace.locator('summary')).toBeFocused();
    if (mobile) await expect(page.locator('.sidebar')).toHaveClass(/is-open/);

    await program.locator('summary').click();
    await page.keyboard.press('Tab');
    await expect(program).not.toHaveAttribute('open');
    await program.locator('summary').click();
    if (mobile) {
      await page.locator('.sidebar-backdrop').click({ position: { x: 380, y: 400 } });
    } else {
      await page.locator('.breadcrumb').click();
    }
    await expect(program).not.toHaveAttribute('open');
  });
}
