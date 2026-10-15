import { test, expect, type Page } from '@playwright/test';
const teacher = 'ИИ в работе учителя 36 часов · учителя · повышение квалификации';
const python = 'Первые шаги в Python 16 часов · школьники · общеразвивающая';
async function create(page: Page, preset = teacher) {
  await page.goto('/');
  await page.getByRole('button', { name: preset, exact: true }).click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.verdict')).toBeVisible();
}
async function tab(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Разделы программы' })
    .getByRole('link', { name, exact: true })
    .click();
}
test('Overview, real tabs, contextual correction and responsive layout preserve programme facts', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await create(page);
  await expect(page.locator('.plan-status')).toHaveCount(0);
  await expect(page.locator('.tab-count')).toHaveAccessibleName('2 вопроса');
  await expect(page.locator('.plan-nav a[aria-current]')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await expect(page.locator('.volume-summary')).toContainText('36 ч');
  await expect(page.locator('main')).not.toContainText('≈');
  expect((await page.locator('.verdict').boundingBox())!.y).toBeLessThan(300);
  await tab(page, 'О программе');
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
  await expect(page.locator('.zero-columns')).toContainText('Лабораторных нет');
  await expect(page.locator('.acr-plan tfoot')).toContainText('36');
  await page.locator('.topic-details summary').first().click();
  await expect(page.locator('.topic-content').first()).toBeVisible();
  await page.screenshot({ path: '../reports/curriculum-workspace-1440.png' });
  await page.locator('.verdict').getByRole('link', { name: 'К первому вопросу' }).press('Enter');
  await expect(page.locator('.decision-item.field-highlight')).toBeFocused();
  await expect(page.locator('.decision-item.field-highlight')).toContainText(
    'Календарь · параметры нагрузки',
  );
  await page.screenshot({ path: '../reports/review-workspace-1440.png' });
  await page
    .locator('.decision-item.field-highlight')
    .getByRole('link', { name: 'Открыть место в программе' })
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
  await expect(page.locator('.verdict')).toContainText('Блокирует утверждение: 1');
  await page.screenshot({ path: '../reports/calendar-workspace-1440.png' });
  await tab(page, 'Решения и утверждение');
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Утвердить программу', exact: true }),
  ).toBeDisabled();
  for (const width of [1440, 1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['О программе', 'Учебный план', 'Календарь', 'Решения и утверждение']) {
      await tab(page, name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await tab(page, 'О программе');
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
  await tab(page, 'О программе');
  await expect(page.locator('.audience-facts')).toBeVisible();
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
  await tab(page, 'О программе');
  await expect(page.locator('.goal-statement')).toContainText(
    'Создать программу с условием и циклом',
  );
  await tab(page, 'Решения и утверждение');
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Утвердить программу', exact: true }),
  ).toBeDisabled();
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await page.getByRole('checkbox', { name: /Цель, результаты, часы/ }).check();
  await page.getByRole('button', { name: 'Утвердить программу', exact: true }).click();
  await expect(page.locator('.verdict')).toContainText('Программа утверждена');
  await tab(page, 'О программе');
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

test('A coverage remark opens the assessment field', async ({ page }) => {
  await create(page, python);
  await page.getByRole('button', { name: 'Редактировать программу', exact: true }).click();
  await page.getByText('Оценочные материалы', { exact: true }).click();
  await page.getByRole('button', { name: 'Удалить оценочное средство 2', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить новую ревизию', exact: true }).click();
  await page.locator('.verdict').getByRole('link', { name: 'К первому вопросу' }).click();
  await page
    .locator('.decision-item.field-highlight')
    .getByRole('link', { name: 'Открыть место в программе' })
    .click();
  await expect(page.locator('.assessment-plan-editor')).toHaveAttribute('open', '');
  await expect(page.locator('.assessment-plan-editor input.field-highlight')).toBeFocused();
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
});

test('Programme states preserve approval, archive restrictions and materials access at all target widths', async ({
  page,
}) => {
  await create(page, python);
  const capture = async (state: string) => {
    for (const width of [1440, 1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `../reports/plan-${state}-${width}.png`,
        animations: 'disabled',
      });
    }
  };
  await expect(page.locator('.tab-count')).toHaveCount(0);
  await expect(page.locator('.verdict')).toContainText('Можно утверждать');
  await capture('no-remarks');
  await page.getByRole('button', { name: 'Редактировать программу', exact: true }).click();
  await tab(page, 'Решения и утверждение');
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await page.getByRole('checkbox', { name: /Цель, результаты, часы/ }).check();
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Утвердить программу', exact: true }),
  ).toBeDisabled();
  await capture('editing');
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await page.getByRole('button', { name: 'Утвердить программу', exact: true }).click();
  await expect(page.locator('.verdict')).toContainText('Программа утверждена');
  await expect(
    page.locator('.verdict').getByRole('link', { name: 'Перейти к материалам', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Утвердить программу', exact: true }),
  ).toBeDisabled();
  await capture('approved');
  const planUrl = page.url();
  await page
    .locator('.verdict')
    .getByRole('link', { name: 'Перейти к материалам', exact: true })
    .click();
  await expect(page).toHaveURL(/\/materials/);
  await page.goto(planUrl);
  await tab(page, 'О программе');
  await page.getByRole('button', { name: 'Изменить цель обучения', exact: true }).click();
  await page
    .getByLabel('Цель обучения', { exact: true })
    .fill('Объяснять устройство программы и проверять результат её работы.');
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(page.locator('.save-feedback')).toBeVisible();
  await page.getByLabel('Версия курса').selectOption('1');
  await expect(
    page.getByRole('button', { name: 'Редактировать программу', exact: true }),
  ).toBeDisabled();
  await tab(page, 'О программе');
  await expect(
    page.getByRole('button', { name: 'Изменить цель обучения', exact: true }),
  ).toBeDisabled();
  await tab(page, 'Решения и утверждение');
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Утвердить программу', exact: true }),
  ).toBeDisabled();
  await capture('archived');
});

test('Only blockers appear in the compact summary and assessment forms stay visible', async ({
  page,
}) => {
  await create(page);
  const issues = page.locator('.verdict-queue > li');
  await expect(issues).toHaveCount(2);
  await expect(page.locator('.verdict-issue-label.blocking')).toHaveCount(2);
  await expect(page.locator('.verdict-issue-label').filter({ hasText: 'К сведению' })).toHaveCount(
    0,
  );
  for (const issue of await issues.all()) {
    await expect(issue.locator('.verdict-issue-heading')).toBeVisible();
  }
  await expect(page.locator('.verdict-queue .verdict-evidence')).toHaveCount(2);
  for (const evidence of await page.locator('.verdict-queue .verdict-evidence').all()) {
    await expect(evidence).toBeVisible();
  }
  await expect(page.locator('.verdict h2')).toHaveText('Блокируют утверждение: 2');
  await page.setViewportSize({ width: 1000, height: 900 });
  expect((await page.locator('.verdict').boundingBox())!.height).toBeLessThan(200);
  expect((await page.locator('.plan-nav').boundingBox())!.y).toBeLessThan(600);
  await page.screenshot({ path: '../reports/visible-issues-1000.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../reports/visible-issues-390.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await tab(page, 'Учебный план');
  const control = page.locator('#topic-1 .control-cell');
  await expect(control).toContainText('Практическое задание по теме «Риски, этика и данные детей»');
  await expect(control).toContainText('Тест по теме «Риски, этика и данные детей»');
  await expect(page.locator('.control-cell details')).toHaveCount(0);
  expect(
    await page
      .locator('.control-cell li')
      .evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth)),
  ).toBe(true);
  await expect(page.locator('.final-row .control-cell li')).toHaveCount(1);
  await expect(page.locator('.final-row .control-cell')).toContainText(
    'Зачёт по портфолио из трёх материалов',
  );
  await page.screenshot({ path: '../reports/named-assessments-1440.png', fullPage: true });
});
