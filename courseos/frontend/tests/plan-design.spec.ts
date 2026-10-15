import { test, expect, type Page } from '@playwright/test';
const teacher = 'ИИ в работе учителя 36 часов · учителя · повышение квалификации';
const python = 'Первые шаги в Python 16 часов · школьники · общеразвивающая';
async function create(page: Page, preset = teacher) {
  await page.goto('/');
  await page.getByRole('button', { name: preset, exact: true }).click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Замысел программы', exact: true })).toBeVisible();
}
async function tab(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Разделы каркаса' })
    .getByRole('link', { name, exact: true })
    .click();
}
test('Overview, real tabs, contextual correction and responsive layout preserve programme facts', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await create(page);
  await expect(page.locator('.plan-metrics')).toContainText('36 уч. ч.');
  await expect(page.locator('.plan-metrics')).toContainText('27,058 уч. ч.');
  expect((await page.locator('.program-intent').boundingBox())!.y).toBeLessThan(440);
  expect((await page.locator('.sidebar').boundingBox())!.width).toBe(248);
  await expect(page.locator('.outcome-group li')).toHaveCount(5);
  await expect(page.getByRole('heading', { name: 'Календарь и учебная нагрузка' })).toBeHidden();
  await page.screenshot({ path: '../reports/plan-workspace-1440.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Свернуть навигацию', exact: true }).click();
  expect((await page.locator('.sidebar').boundingBox())!.width).toBe(72);
  await page.getByRole('button', { name: 'Развернуть навигацию', exact: true }).click();
  await page.locator('#why-hours > summary').press('Enter');
  await expect(page.locator('#why-hours')).toHaveAttribute('open', '');
  await page.locator('#why-hours > summary').press('Enter');
  await tab(page, 'Учебный план');
  await expect(page.locator('.program-intent')).toBeHidden();
  await page.getByText('Подробные расчёты часов', { exact: true }).click();
  await expect(page.locator('.plan-calculations')).toContainText(
    '33,5 обучение + 2,5 аттестация = 36 всего',
  );
  await page.locator('.topic-details summary').first().click();
  await expect(page.locator('.topic-content').first()).toBeVisible();
  await page.screenshot({ path: '../reports/curriculum-workspace-1440.png' });
  await page.getByRole('link', { name: 'Открыть замечание', exact: true }).click();
  await expect(page.locator('.review-issue.field-highlight')).toBeFocused();
  await expect(page.locator('.review-issue.field-highlight')).toContainText(
    'Календарь · параметры нагрузки',
  );
  await page.screenshot({ path: '../reports/review-workspace-1440.png' });
  await page
    .locator('.review-issue.field-highlight')
    .getByRole('link', { name: 'Перейти к исправлению' })
    .click();
  await expect(page.getByLabel('Дата начала', { exact: true })).toBeFocused();
  await expect(page.locator('.calendar-form')).toHaveClass(/field-highlight/);
  await page.getByLabel('Дата начала').fill('2026-10-19');
  await page.getByLabel('Календарных дней').fill('7');
  await page.getByLabel('Максимум часов в день').fill('4');
  await expect(page.locator('.load-conflict')).toContainText('Не размещено 8 уч. ч.');
  await page.getByRole('radio', { name: /Продлить календарь/ }).check();
  await page
    .getByRole('checkbox', { name: 'Подтверждаю изменение срока обучения', exact: true })
    .check();
  await page.getByRole('button', { name: 'Применить и пересчитать' }).click();
  await expect(page.locator('.calendar-summary')).toContainText('Календарь подтверждён');
  await expect(page.locator('.course-meta')).toContainText('Ожидает проверки методиста');
  await page.screenshot({ path: '../reports/calendar-workspace-1440.png' });
  await tab(page, 'Проверка и утверждение');
  await expect(page.getByRole('button', { name: 'Утвердить каркас', exact: true })).toBeDisabled();
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['Замысел', 'Учебный план', 'Календарь', 'Проверка и утверждение']) {
      await tab(page, name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await tab(page, 'Замысел');
  await page.screenshot({ path: '../reports/plan-workspace-320.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../reports/plan-workspace-390.png' });
  expect(errors).toEqual([]);
});
test('Block editing restores a draft, saves only the selected block and requires separate approval', async ({
  page,
  context,
}) => {
  await create(page, python);
  const original = await page.locator('.audience-facts').innerText();
  const originalResults = await page.locator('.outcomes').innerText();
  await page.getByRole('button', { name: 'Изменить цель обучения', exact: true }).click();
  await page
    .getByLabel('Цель обучения', { exact: true })
    .fill('Создать программу с условием и циклом, затем объяснить решение.');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить цель обучения', exact: true }).click();
  await expect(page.getByLabel('Цель обучения', { exact: true })).toHaveValue(
    'Создать программу с условием и циклом, затем объяснить решение.',
  );
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(page.locator('.save-feedback')).toContainText('Изменения сохранены');
  expect(await page.locator('.audience-facts').innerText()).toBe(original);
  expect(await page.locator('.outcomes').innerText()).toBe(originalResults);
  await page.reload();
  await expect(page.locator('.goal-statement')).toContainText(
    'Создать программу с условием и циклом',
  );
  await tab(page, 'Проверка и утверждение');
  await expect(page.getByRole('button', { name: 'Утвердить каркас', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Я проверил цель/ }).check();
  await page.getByRole('button', { name: 'Утвердить каркас', exact: true }).click();
  await expect(page.locator('.course-meta')).toContainText('Каркас утверждён');
  await tab(page, 'Замысел');
  await page.getByRole('button', { name: 'Изменить аудиторию и входной уровень' }).click();
  await page.getByLabel('Аудитория', { exact: true }).fill('Слушатели без опыта');
  const other = await context.newPage();
  await other.goto(page.url());
  await other.getByRole('button', { name: 'Изменить цель обучения', exact: true }).click();
  await other
    .getByLabel('Цель обучения', { exact: true })
    .fill('Цель новой версии во второй вкладке');
  await other.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(other.locator('.save-feedback')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Версия устарела' })).toBeVisible();
  await expect(page.getByLabel('Аудитория', { exact: true })).toHaveValue('Слушатели без опыта');
  await other.close();
});

test('A coverage remark opens the assessment field and a methodist remark opens its rationale', async ({
  page,
}) => {
  await create(page, python);
  await page.getByRole('button', { name: 'Редактировать каркас', exact: true }).click();
  await page.getByText('План оценивания и критерии', { exact: true }).click();
  await page.getByRole('button', { name: 'Удалить средство assessment-1-b', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить новую ревизию', exact: true }).click();
  await page.getByRole('link', { name: 'Открыть замечание', exact: true }).click();
  await page
    .locator('.review-issue.field-highlight')
    .getByRole('link', { name: 'Перейти к исправлению' })
    .click();
  await expect(page.locator('.assessment-plan-editor')).toHaveAttribute('open', '');
  await expect(page.locator('.assessment-plan-editor input.field-highlight')).toBeFocused();
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await tab(page, 'Проверка и утверждение');
  await page.getByRole('link', { name: 'Отчёт проверки программы', exact: true }).click();
  await page
    .getByLabel('Конкретное замечание', { exact: true })
    .fill('Уточните основание достижимости для этой аудитории.');
  await page.getByRole('checkbox', { name: /Ставит под сомнение/ }).check();
  await page.getByRole('button', { name: 'Записать замечание', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Уточните основание достижимости для этой аудитории.',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Каркас и учебный план', exact: true }).click();
  await page.getByRole('link', { name: 'Открыть замечание', exact: true }).click();
  await expect(page.locator('.review-issue.field-highlight')).toContainText('Оценка методиста');
  await page
    .locator('.review-issue.field-highlight')
    .getByRole('link', { name: 'Перейти к исправлению' })
    .click();
  await expect(page.locator('#why-reachability')).toHaveAttribute('open', '');
  await expect(page.getByLabel('Исправление основания', { exact: true })).toBeVisible();
  await page
    .getByLabel('Исправление основания', { exact: true })
    .fill(
      'Для входного уровня предусмотрены практикумы с обратной связью; результаты требуют предметной проверки.',
    );
  await page.getByRole('button', { name: 'Сохранить исправление', exact: true }).click();
  await expect(page.locator('.save-feedback')).toContainText(
    'Каркас ожидает отдельного утверждения',
  );
});
