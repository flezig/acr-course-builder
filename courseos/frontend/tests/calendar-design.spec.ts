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
  await form.getByText('Сохранить с нехваткой часов', { exact: true }).click();
  await expect(form.locator('.calendar-result')).toContainText('Нехватка 11 уч. ч. сохранится');
  await form.getByRole('radio', { name: /Сохранить с нехваткой часов/ }).focus();
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
  await expect(page.locator('.calendar-panel')).toContainText('Настройте календарь');
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
  await expect(form.getByRole('radio')).toHaveCount(0);
  const apply = form.getByRole('button', { name: 'Сохранить календарь', exact: true });
  await expect(apply).toBeDisabled();
  await form.getByLabel('Подтверждаю даты и учебные дни', { exact: true }).check();
  await expect(apply).toBeEnabled();
  await form.getByRole('checkbox', { name: 'Только будни', exact: true }).uncheck();
  await expect(form.locator('.calendar-problem')).toContainText('7 учебных дней');
  await expect(form.locator('.calendar-problem')).toContainText('доступно 56 уч. ч.');
  await expect(apply).toBeDisabled();
});

for (const width of [1440, 390]) {
  test(`Нехватка часов в расписании исправляется из блокировки: ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page
      .getByRole('button', {
        name: 'ИИ в работе учителя 36 часов · учителя · повышение квалификации',
      })
      .click();
    await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
    await answerDemoQuestions(page);
    await page.getByRole('link', { name: 'Календарь', exact: true }).click();
    await page.getByRole('button', { name: 'Изменить календарь' }).click();
    const form = page.locator('.calendar-form');
    await form.getByLabel('Дата начала', { exact: true }).fill('2026-10-15');
    await form.getByLabel('Календарных дней').fill('20');
    await form.getByLabel('Максимум часов в день').fill('5');
    await form.getByRole('checkbox', { name: 'Только будни', exact: true }).uncheck();
    await form.locator('.calendar-schedule > summary').click();
    await form
      .getByRole('checkbox', { name: 'Назначить занятия по темам учебного плана', exact: true })
      .check();
    await expect(form.locator('.calendar-problem')).toContainText(
      'доступно 10 уч. ч. Не хватает 26 уч. ч.',
    );
    await expect(page.locator('.calendar-overview')).toContainText(
      'Не хватает 26 уч. ч. в расписании',
    );
    await form.getByRole('radio', { name: /Сохранить с нехваткой часов/ }).check();
    await form
      .getByRole('checkbox', { name: 'Подтверждаю сохранение календаря с нехваткой часов' })
      .check();
    await form.getByRole('button', { name: 'Применить и пересчитать' }).click();
    await expect(form).toHaveCount(0);
    await page.getByRole('link', { name: 'Решения', exact: true }).click();
    const issue = page.locator('.decision-item').filter({
      has: page.getByRole('heading', {
        name: 'Расписание расходится с учебным планом',
        exact: true,
      }),
    });
    await expect(issue).toContainText('не хватает 26 уч. ч.');
    await issue.getByRole('link', { name: 'Исправить календарь' }).click();
    await expect(form).toBeVisible();
    await expect(form.locator('.calendar-schedule')).toHaveAttribute('open', '');
    await expect(form).not.toHaveClass(/field-highlight/);
    await form.getByRole('radio', { name: /Продлить календарь/ }).check();
    await expect(form.locator('.calendar-result')).toContainText('18 учебных дней');
    await form
      .getByRole('checkbox', { name: 'Подтверждаю изменение срока обучения', exact: true })
      .check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .locator('.calendar-panel')
      .screenshot({ path: `../reports/calendar-redesign-${width}.png` });
    await form.getByRole('button', { name: 'Применить и пересчитать' }).click();
    await expect(form).toHaveCount(0);
    await expect(page.locator('.calendar-overview')).toContainText(
      'Календарь согласован с учебным планом',
    );
    const calendar = await page.evaluate(() => {
      const database = JSON.parse(localStorage.getItem('courseos-demo-v1')!);
      const course = Object.values(database.courses)[0] as {
        snapshots: {
          skeleton: {
            requirements: { total_hours: string };
            sessions: { hours: Record<string, string> }[];
          };
        }[];
      };
      return course.snapshots.at(-1)!.skeleton;
    });
    expect(calendar.requirements.total_hours).toBe('36');
    expect(
      calendar.sessions
        .flatMap((session) => Object.values(session.hours))
        .reduce((sum, hours) => sum + Number(hours), 0),
    ).toBe(36);
    await page
      .locator('.calendar-panel')
      .screenshot({ path: `../reports/calendar-resolved-${width}.png` });
    await page.getByRole('button', { name: 'Изменить календарь', exact: true }).click();
    await form.getByLabel('Максимум часов в день').fill('8');
    await form
      .getByRole('checkbox', {
        name: 'Как методист, согласен с увеличением дневной нагрузки',
        exact: true,
      })
      .check();
    await form.getByRole('button', { name: 'Сохранить календарь', exact: true }).click();
    await expect(form).toHaveCount(0);
  });
}
