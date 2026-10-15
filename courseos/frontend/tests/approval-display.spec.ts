import { test, expect } from '@playwright/test';

for (const width of [1440, 390, 320]) {
  test(`Утверждение: причины, подтверждение и сведения при ширине ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const blocked of [true, false]) {
      await page.goto('/');
      await page
        .getByRole('button', {
          name: blocked
            ? 'ИИ в работе учителя 36 часов · учителя · повышение квалификации'
            : 'Первые шаги в Python 16 часов · школьники · общеразвивающая',
          exact: true,
        })
        .click();
      await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
      await expect(page.locator('.verdict')).toBeVisible();
      const firstIssue = blocked
        ? await page
            .locator('.verdict')
            .getByRole('link', { name: 'К первому вопросу', exact: true })
            .getAttribute('href')
        : null;
      await page.getByRole('link', { name: 'Решения и утверждение', exact: true }).click();
      await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
      const panel = page.locator('.approval-panel');
      const checkbox = panel.getByRole('checkbox');
      const approve = panel.getByRole('button', { name: 'Утвердить программу', exact: true });
      await expect(approve).toBeDisabled();
      if (blocked) {
        await expect(checkbox).toBeDisabled();
        const hint = panel.getByRole('link', { name: /^Сначала закройте/ });
        await expect(hint).toHaveAttribute('href', firstIssue!);
        await hint.press('Enter');
        await expect(page.locator('.decision-item.field-highlight')).toBeVisible();
        await expect(page).toHaveURL(new RegExp(firstIssue!.split('#')[1] + '$'));
        await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
      } else {
        await expect(panel).toContainText('Отметьте подтверждение проверки');
        await checkbox.check();
        await expect(panel.locator('.approval-hint')).toHaveCount(0);
        await expect(approve).toBeEnabled();
        await page.screenshot({ path: `../reports/approval-ready-${width}.png`, fullPage: true });
        await approve.click();
        await expect(panel).toContainText('Программа утверждена.');
        await expect(panel.getByRole('checkbox')).toHaveCount(0);
      }
      await panel.locator('summary').click();
      await expect(panel.locator('details')).toHaveAttribute('open', '');
      await expect(panel.locator('summary')).toHaveCSS('font-weight', '400');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `../reports/approval-${blocked ? 'blocked' : 'approved'}-${width}.png`,
        fullPage: true,
      });
    }
  });
}
