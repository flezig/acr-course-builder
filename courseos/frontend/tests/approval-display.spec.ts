import { answerDemoQuestions } from './answer-demo-questions';
import { test, expect } from '@playwright/test';

for (const width of [1440, 390, 320]) {
  test(`Утверждение в шапке: причины, подтверждение и история при ширине ${width}`, async ({
    page,
  }) => {
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
      await answerDemoQuestions(page);
      await expect(page.locator('.verdict')).toBeVisible();
      const firstIssue = blocked
        ? await page
            .locator('.verdict')
            .getByRole('link', { name: 'К первому вопросу', exact: true })
            .getAttribute('href')
        : null;
      const panel = page.locator('.approval-action');
      const approve = panel.getByRole('button', { name: 'Утвердить', exact: true });
      if (blocked) {
        await expect(approve).toBeDisabled();
        const hint = panel.getByRole('link', { name: /^Сначала закройте/ });
        await expect(hint).toHaveAttribute('href', firstIssue!);
        await hint.press('Enter');
        await expect(page.locator('.decision-item.field-highlight')).toBeVisible();
        await expect(page).toHaveURL(new RegExp(firstIssue!.split('#')[1] + '$'));
      } else {
        await expect(approve).toBeEnabled();
        await expect(panel.locator('.approval-hint')).toHaveCount(0);
        await approve.click();
        const confirm = panel.getByRole('group', { name: 'Подтверждение утверждения' });
        await expect(confirm).toContainText('Цель, результаты, часы, оценивание и основания');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: `../reports/approval-ready-${width}.png` });
        await confirm.getByRole('button', { name: 'Подтвердить утверждение', exact: true }).click();
        await expect(panel).toContainText('Программа утверждена');
        await expect(approve).toHaveCount(0);
        await page.getByRole('link', { name: 'Решения и утверждение', exact: true }).click();
        await page.getByRole('tab', { name: 'Обоснования', exact: true }).click();
        await expect(page.getByRole('list', { name: 'История утверждений' })).toContainText(
          'Версия 1 утверждена',
        );
      }
      // Технические идентификаторы версии методисту не показываются.
      await expect(panel).not.toContainText('SHA-256');
      await expect(page.locator('.approval-records')).not.toContainText('SHA-256');
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
