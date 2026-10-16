import { expect, test } from '@playwright/test';

async function openSection(page: import('@playwright/test').Page, name: string) {
  const section = page
    .locator('.create-references > details')
    .filter({ has: page.locator('summary', { hasText: name }) });
  await section.locator('summary').click();
  return section;
}

test('Создание курса сохраняет прошлую программу, каталог профстандартов и несколько ссылок', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /ИИ в работе учителя 36 часов/ }).click();
  const previous = await openSection(page, 'Прошлая программа');
  await previous
    .getByLabel('Текст прошлой программы')
    .pressSequentially('Прошлая программа: анализ заданий и практика.');
  await previous.getByLabel('Ссылка на прошлую программу').fill('https://example.com/previous');
  const standards = await openSection(page, 'Профстандарт');
  await expect(standards.getByLabel('Профстандарт программы')).toHaveValue('teachers');
  await standards.getByLabel('Профстандарт программы').selectOption('devops');
  const links = await openSection(page, 'Полезные ссылки');
  await links.getByLabel('Название ссылки').fill('Руководство по практике');
  await links.getByLabel('URL полезной ссылки').fill('ftp://example.com/guide');
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(links.getByLabel('URL полезной ссылки')).toBeFocused();
  await expect(links.getByLabel('URL полезной ссылки')).toHaveAccessibleDescription(
    /Введите полную ссылку/,
  );
  await links.getByLabel('URL полезной ссылки').fill('https://example.com/guide');
  await links.getByRole('button', { name: 'Добавить ещё ссылку' }).click();
  await links.getByLabel('Название ссылки').nth(1).fill('Дополнительные задания');
  await links.getByLabel('URL полезной ссылки').nth(1).fill('https://example.com/tasks');
  await expect(page.getByText('Происхождение и проверка фрагмента')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Получить текст по ссылке' })).toHaveCount(0);
  await page.reload();
  await page
    .locator('.create-references > details')
    .filter({ hasText: 'Прошлая программа' })
    .locator('summary')
    .click();
  await expect(page.getByLabel('Текст прошлой программы')).toHaveValue(
    'Прошлая программа: анализ заданий и практика.',
  );
  await page
    .getByRole('checkbox', { name: 'Подтверждаю параметры изменённого запроса вручную' })
    .check();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.verdict')).toBeVisible();
  await page.getByRole('link', { name: 'Учебный план', exact: true }).click();
  await page.getByRole('link', { name: 'О программе', exact: true }).click();
  await expect(page.locator('#standard')).toContainText('06.026');
  await expect(page.locator('#program-references')).toContainText('Прошлая программа');
  await expect(page.locator('#program-references')).toContainText('Руководство по практике');
  await expect(page.locator('#program-references')).toContainText('Дополнительные задания');
  await page.getByRole('link', { name: 'Карта результатов', exact: true }).click();
  const sources = page.locator('#sources .source');
  await expect(sources).toHaveCount(4);
  await expect(sources).toContainText([
    'Прошлая программа',
    'Профстандарт 06.026',
    'Руководство по практике',
    'Дополнительные задания',
  ]);
  const guide = sources.filter({ hasText: 'Руководство по практике' });
  await guide.locator('summary').click();
  await expect(guide).toContainText('Содержимое URL не загружено');
  await expect(guide.getByRole('link')).toHaveAttribute('href', 'https://example.com/guide');
  await page.reload();
  await expect(page.locator('#sources .source')).toHaveCount(4);
  await page.locator('#sources').screenshot({ path: '../reports/create-references-sources.png' });
});

test('Свой профстандарт и референсы примера заполняют форму; выбор без профстандарта удаляет только его', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /DevOps: Linux/ }).click();
  const previous = await openSection(page, 'Прошлая программа');
  await expect(previous.getByLabel('Текст прошлой программы')).toHaveValue(/Учебный план образца/);
  await expect(previous.getByLabel('Название прошлой программы')).toHaveValue(/Образец АЦР/);
  const standards = await openSection(page, 'Профстандарт');
  await expect(standards.getByLabel('Профстандарт программы')).toHaveValue('devops');
  await standards.getByLabel('Профстандарт программы').selectOption('custom');
  await standards.getByLabel('Название и код профстандарта').fill('Профстандарт методиста');
  await standards
    .getByLabel('Текст профстандарта', { exact: true })
    .pressSequentially('Собственная редакция с трудовыми функциями.');
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.verdict')).toBeVisible();
  await page.getByRole('link', { name: 'Учебный план', exact: true }).click();
  await page.getByRole('link', { name: 'О программе', exact: true }).click();
  const standard = page.locator('#standard');
  await expect(standard).toContainText('предоставлен методистом');
  await standard.getByRole('button', { name: 'Изменить профстандарт' }).click();
  await expect(standard.getByLabel('Название и код профстандарта')).toHaveValue(
    'Профстандарт методиста',
  );
  await expect(standard.getByLabel('Текст профстандарта', { exact: true })).toHaveValue(
    'Собственная редакция с трудовыми функциями.',
  );
  await standard.getByLabel('Профстандарт программы').selectOption('');
  await standard.getByRole('button', { name: 'Сохранить профстандарт' }).click();
  await expect(standard).toContainText('текст профстандарта не приложен');
  await page.getByRole('link', { name: 'Карта результатов', exact: true }).click();
  await expect(page.locator('#sources .source')).toHaveCount(1);
  await expect(page.locator('#sources')).toContainText('Образец АЦР');
});

test('Без профстандарта при создании и честная ошибка PDF в демо', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /ИИ в работе учителя 36 часов/ }).click();
  const standards = await openSection(page, 'Профстандарт');
  await standards.getByLabel('Профстандарт программы').selectOption('');
  await page.getByLabel('Загрузить PDF или DOCX').setInputFiles({
    name: 'program.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  await expect(page.getByRole('alert')).toContainText('Вставьте текст');
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.verdict')).toBeVisible();
  await page.getByRole('link', { name: 'Учебный план', exact: true }).click();
  await page.getByRole('link', { name: 'О программе', exact: true }).click();
  await expect(page.locator('#standard')).toContainText('текст профстандарта не приложен');
});
