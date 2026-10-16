import { answerDemoQuestions } from './answer-demo-questions';
import { test, expect } from '@playwright/test';
test('Calendar decisions require fresh consent and reflow', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'ИИ в работе учителя 36 часов · учителя · повышение квалификации',
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await answerDemoQuestions(page);
  await page.getByRole('link', { name: 'Календарь', exact: true }).click();
  await expect(page.locator('.calendar-form')).toHaveCount(0);
  await page.getByRole('button', { name: 'Изменить календарь' }).click();
  const form = page.locator('.calendar-form');
  await form.getByLabel('Дата начала').fill('2026-10-19');
  await form.getByLabel('Календарных дней').fill('5');
  await form.getByLabel('Максимум часов в день').fill('5');
  await expect(form.locator('.calendar-problem')).toContainText(
    'Нужно 36 уч. ч., доступно 25 уч. ч. Не хватает 11 уч. ч.',
  );
  await expect(form.locator('input[type=radio]:checked')).toHaveCount(0);
  const apply = form.getByRole('button', { name: 'Применить и пересчитать' });
  await expect(apply).toBeDisabled();
  await form.getByText('Сохранить текущий календарь', { exact: true }).click();
  await expect(form.locator('.calendar-result')).toContainText('Нехватка 11 уч. ч. сохранится');
  await form.getByRole('radio', { name: /Сохранить текущий календарь/ }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(form.getByRole('radio', { name: /Продлить календарь/ })).toBeChecked();
  await expect(form.locator('.calendar-result')).toContainText('8 учебных дней');
  await form.getByLabel('Подтверждаю изменение срока обучения', { exact: true }).check();
  await expect(apply).toBeEnabled();
  await form.getByText('Увеличить дневную нагрузку', { exact: true }).click();
  await expect(form.locator('.calendar-result')).toContainText('7,5 уч. ч. в день');
  await expect(apply).toBeDisabled();
  await form
    .getByRole('checkbox', { name: 'Как методист, согласен с увеличением дневной нагрузки' })
    .check();
  await form.getByLabel('Максимум часов в день').fill('4,5');
  await expect(apply).toBeDisabled();
  await expect(form.locator('.calendar-problem')).toContainText('доступно 22,5 уч. ч.');
  await form.getByText('Сократить объём', { exact: true }).click();
  await expect(form.locator('.calendar-result')).toContainText(
    'Программа потребует пересмотра и утверждения',
  );
  await form.getByLabel('Максимум часов в день').fill('');
  await expect(apply).toHaveCount(0);
  await expect(form.locator('.calendar-problem')).toContainText('Заполните параметры для расчёта');
  await form.getByLabel('Максимум часов в день').fill('5');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await expect(page.locator('.sidebar')).toBeHidden();
  await form.getByLabel('Максимум часов в день').blur();
  await page.mouse.move(0, 0);
  await form.screenshot({ path: '../reports/calendar-mobile.png' });
});

test('Empty, partial, invalid and sufficient calendar', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'ИИ в работе учителя 36 часов · учителя · повышение квалификации',
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await answerDemoQuestions(page);
  await page.getByRole('link', { name: 'Календарь', exact: true }).click();
  await expect(page.locator('.calendar-panel')).toContainText('Заполните параметры для расчёта');
  await page.getByRole('button', { name: 'Изменить календарь' }).click();
  const form = page.locator('.calendar-form');
  await expect(form.locator('.field-error')).toHaveCount(0);
  await expect(form.locator('.resolution-options')).toHaveCount(1);
  await form.getByLabel('Дата начала', { exact: true }).fill('2026-10-19');
  await expect(form.locator('.calendar-problem')).toHaveText('Заполните параметры для расчёта');
  await form.getByLabel('Календарных дней').fill('0');
  await form.getByLabel('Календарных дней').blur();
  await expect(form.getByLabel('Календарных дней')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByLabel('Календарных дней')).toHaveAccessibleDescription(
    /не меньше 1|от 1 до 3650/,
  );
  await form.getByLabel('Календарных дней').fill('7');
  await form.getByLabel('Максимум часов в день').fill('0');
  await form.getByLabel('Максимум часов в день').blur();
  await expect(form.getByLabel('Максимум часов в день')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByLabel('Максимум часов в день')).toHaveAccessibleDescription(/больше нуля/);
  await form.getByRole('checkbox', { name: 'Только будни', exact: true }).check();
  await form.getByLabel('Максимум часов в день').fill('8');
  await expect(form.locator('.calendar-problem')).toContainText('5 учебных дней');
  await expect(form.locator('.calendar-problem')).toContainText(
    'доступно 40 уч. ч. Часов достаточно',
  );
  await expect(form.locator('.has-deficit')).toHaveCount(0);
  await form.getByText('Сохранить текущий календарь', { exact: true }).click();
  const apply = form.getByRole('button', { name: 'Применить и пересчитать' });
  await expect(apply).toBeDisabled();
  await form.getByLabel('Подтверждаю даты и учебные дни', { exact: true }).check();
  await expect(apply).toBeEnabled();
  await form.getByRole('checkbox', { name: 'Только будни', exact: true }).uncheck();
  await expect(form.locator('.calendar-problem')).toContainText('7 учебных дней');
  await expect(form.locator('.calendar-problem')).toContainText('доступно 56 уч. ч.');
  await expect(apply).toBeDisabled();
});
