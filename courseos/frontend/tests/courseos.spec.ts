import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { editDraft } from './create-draft';
const reports = path.resolve('../reports');
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});
async function createPython(page: Page, incomplete = false) {
  await page
    .getByRole('button', { name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая' })
    .click();
  if (incomplete) await editDraft(page, (draft) => (draft.entry_level = ''));
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  if (incomplete) {
    await page
      .getByLabel('Какой входной уровень слушателей?', { exact: true })
      .fill('Без опыта программирования');
    await page.getByRole('button', { name: 'Сохранить ответы и построить каркас' }).click();
  }
  await expect(page.locator('.verdict')).toBeVisible();
  return page.url().match(/courses\/([^/]+)/)![1];
}
// Находки, которые нельзя применить автоматически, методист оставляет с причиной.
async function keepFindings(page: Page) {
  await page.getByRole('link', { name: 'Решения и утверждение', exact: true }).click();
  await page.getByRole('tab', { name: /^Решения/ }).click();
  const queue = page.locator('.decision-queue');
  while (await queue.getByRole('button', { name: 'Оставить как есть' }).count()) {
    await queue.getByRole('button', { name: 'Оставить как есть' }).first().click();
    await page.getByLabel('Почему оставить как есть').fill('Проверено методистом вручную');
    await page.getByRole('button', { name: 'Сохранить решение' }).click();
    await expect(page.getByLabel('Почему оставить как есть')).toHaveCount(0);
  }
}
async function approveAndWait(page: Page) {
  await page.getByRole('link', { name: 'Решения и утверждение', exact: true }).click();
  await page.getByRole('tab', { name: 'Утверждение', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: 'Цель, результаты, часы, оценивание и основания проверены. Утверждаю эту ревизию.',
    })
    .check();
  await page.getByRole('button', { name: 'Утвердить программу', exact: true }).click();
  await expect(
    page.locator('.verdict').getByRole('link', { name: 'Перейти к материалам', exact: true }),
  ).toBeVisible({
    timeout: 15000,
  });
  await page
    .locator('.verdict')
    .getByRole('link', { name: 'Перейти к материалам', exact: true })
    .click();
  await expect(page.getByText('Технически: черновик полный')).toBeVisible();
}
test('Полный путь: уточнения, правка каркаса, аудит, ручная правка и выгрузка JSON', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByRole('button', { name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая' })
    .click();
  await editDraft(page, (draft) => (draft.entry_level = ''));
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Уточните 1 параметров' })).toBeVisible();
  await page.getByLabel('Какой входной уровень слушателей?').fill('Без опыта программирования');
  await page.getByRole('button', { name: 'Сохранить ответы и построить каркас' }).click();
  await expect(page.locator('.verdict')).toBeVisible();
  const id = page.url().match(/courses\/([^/]+)/)![1];
  await expect(page.locator('.explanation')).toHaveCount(5);
  await expect(page.locator('.approval-panel > button.primary')).toBeDisabled();
  await page.getByRole('button', { name: 'Редактировать программу' }).click();
  await page
    .getByRole('textbox', { name: 'Цель', exact: true })
    .fill('Создать небольшую программу с переменными, условиями и циклом; объяснить решение.');
  await page.getByRole('button', { name: 'Сохранить новую ревизию' }).click();
  await expect(page.getByRole('heading', { name: 'Редактирование программы' })).toHaveCount(0);
  await approveAndWait(page);
  await page
    .locator('.sidebar')
    .getByRole('link', { name: 'Проверка программы', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Проверка программы', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Итог с итоговой аттестацией равен объёму')).toBeVisible();
  await page.goBack();
  await page
    .getByRole('button', { name: 'Практикум: Знакомство с Python Семинар', exact: true })
    .click();
  await expect(page.locator('.material-viewer')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ручная правка', exact: true }).click();
  await page
    .getByLabel('Содержание материала')
    .fill('Ручная правка методиста: проверить два сценария ввода и объяснить результат.');
  await page.getByRole('button', { name: 'Сохранить и защитить ручную правку' }).click();
  await expect(page.getByText('Ручная правка защищена')).toBeVisible();
  await page.getByRole('tab', { name: 'Выгрузки', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать JSON' }).click();
  const download = await downloadPromise;
  await mkdir(reports, { recursive: true });
  const exportPath = path.join(reports, 'e2e-python-export.json');
  await download.saveAs(exportPath);
  const snapshot = JSON.parse(await readFile(exportPath, 'utf8'));
  expect(snapshot.course_id).toBe(id);
  expect(snapshot.mode).toBe('demo');
  expect(snapshot.draft).toBe(true);
  expect(
    snapshot.materials.find((m: { id: string }) => m.id === 'seminar-topic-1').content,
  ).toContain('Ручная правка методиста');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Выгрузки комплекта' })).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(reports, 'exports-1440.png') });
});
test('DevOps: подтвердить56дней, увидеть64/32, решить продлением и отдельно утвердить', async ({
  page,
}) => {
  await page
    .getByRole('button', {
      name: 'DevOps: Linux → CI/CD 256 часов · стажировка · календарный конфликт',
    })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await page.getByRole('link', { name: 'Календарь', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Календарь и учебная нагрузка' })).toBeVisible();
  await page.getByRole('button', { name: 'Изменить календарь' }).click();
  await page.getByRole('radio', { name: /Сохранить текущий календарь/ }).check();
  await page
    .getByRole('checkbox', {
      name: 'Подтверждаю сохранение календаря с нехваткой часов',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Применить и пересчитать' }).click();
  await page.getByRole('button', { name: 'Изменить календарь' }).click();
  await expect(page.locator('.calendar-problem')).toContainText(
    'Нужно 256 уч. ч., доступно 224 уч. ч. Не хватает 32 уч. ч.',
  );
  await expect(page.locator('.approval-panel > button.primary')).toBeDisabled();
  await page.screenshot({ path: path.join(reports, 'devops-conflict-1440.png') });
  await page.getByRole('radio', { name: 'Продлить календарь', exact: false }).check();
  await page
    .getByRole('checkbox', { name: 'Подтверждаю изменение срока обучения', exact: true })
    .check();
  await page.getByRole('button', { name: 'Применить и пересчитать' }).click();
  await expect(page.getByRole('heading', { name: 'Календарь и учебная нагрузка' })).toBeVisible();
  await expect(page.locator('.approval-panel > button.primary')).toBeDisabled();
  await keepFindings(page);
  await approveAndWait(page);
  await page.getByRole('tab', { name: 'Выгрузки', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать JSON' }).click();
  const download = await downloadPromise;
  const file = path.join(reports, 'e2e-devops-resolved.json');
  await download.saveAs(file);
  const snapshot = JSON.parse(await readFile(file, 'utf8'));
  expect(snapshot.skeleton.requirements.calendar.calendar_days).toBe(64);
  expect(
    snapshot.skeleton.conflicts.some(
      (c: { decision: { option_id: string } | null }) => c.decision?.option_id === 'extend',
    ),
  ).toBe(true);
  expect(snapshot.approval_applicable).toBe(true);
  expect(
    snapshot.skeleton.topics.every(
      (t: { hours: { lecture: string; practice: string; lab: string } }) =>
        t.hours.lecture === '0' && t.hours.practice === '0' && t.hours.lab === '0',
    ),
  ).toBe(true);
});
test('Рабочие экраны1440/1024, клавиатура, увеличение200%, архив и фильтр', async ({ page }) => {
  const id = await createPython(page);
  await page.screenshot({ path: path.join(reports, 'plan-1440.png') });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: path.join(reports, 'plan-1024.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Карта результатов', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск по карте' }).fill('цик');
  await page.getByRole('button', { name: 'Перейти к таблице' }).click();
  await expect(page.locator('.outcome-list-item')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Поиск по карте' }).press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  await page.goto(`/courses/${id}/plan`);
  await page.getByRole('link', { name: 'Карта результатов', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск по карте' }).fill('');
  // Масштаб200%: эффективный viewport512×384 и визуальный zoom2 внутри окна1024×768.
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await page.screenshot({ path: path.join(reports, 'map-200-percent.png') });
  await expect(page.getByRole('textbox', { name: 'Поиск по карте' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  await page.goto(`/courses/${id}/plan`);
  await approveAndWait(page);
  await page.goto(`/courses/${id}/plan?version=1`);
  await expect(page.getByText('Архив версии 1.', { exact: false })).toBeVisible();
});
test('Длинная новая программа500часов, прокрутка, проблема в середине и возврат', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая' })
    .click();
  await editDraft(page, (draft) => {
    draft.title = 'Архитектура распределённых систем';
    draft.audience = 'Инженеры';
    draft.total_hours = '500';
    draft.calendar.calendar_days = 250;
    draft.calendar.daily_limit = '4';
  });
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.locator('.verdict')).toBeVisible();
  await expect(page.locator('.plan-table tbody tr')).toHaveCount(33);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: path.join(reports, 'long-plan-1024.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Редактировать программу' }).click();
  await page.getByLabel('topic-16 Практика', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Сохранить новую ревизию' }).click();
  await page.getByRole('link', { name: 'Решения и утверждение', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Сумма часов тем не совпадает с объёмом курса' }),
  ).toBeVisible();
  await page
    .locator('#issue-hours-topic-16')
    .getByRole('link', { name: 'Открыть место в программе' })
    .click();
  await expect(page.getByRole('link', { name: 'Учебный план', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('#topic-16')).toBeVisible();
});

test('Конфликт двух вкладок сохраняет черновик и не применяет старую ревизию', async ({
  page,
  context,
}) => {
  const id = await createPython(page);
  await page.getByRole('button', { name: 'Редактировать программу' }).click();
  await page
    .getByRole('textbox', { name: 'Цель', exact: true })
    .fill('Мой несохранённый черновик первой вкладки');
  const other = await context.newPage();
  await other.goto(`/courses/${id}/plan`);
  await other.getByRole('button', { name: 'Редактировать программу' }).click();
  await other.getByRole('textbox', { name: 'Цель', exact: true }).fill('Изменение второй вкладки');
  await other.getByRole('button', { name: 'Сохранить новую ревизию' }).click();
  await expect(other.getByRole('heading', { name: 'Редактирование программы' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Сохранить новую ревизию' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Версия устарела' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Цель', exact: true })).toHaveValue(
    'Мой несохранённый черновик первой вкладки',
  );
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Карта результатов', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Редактирование программы' })).toBeVisible();
  await other.close();
});

test('HTTP-сбой: нет скрытого demo; request_id переживает перезагрузку и меняется с payload', async ({
  page,
}) => {
  const ids: string[] = [];
  await page.route('**/api/v1/courses', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/v1/agent', async (route) => {
    ids.push(route.request().postDataJSON().request_id);
    await route.abort('failed');
  });
  await page.getByLabel('Режим работы', { exact: true }).selectOption('live');
  await expect(page.getByText('LIVE · Данные сервера')).toBeVisible();
  await page
    .getByRole('button', { name: 'Первые шаги в Python 16 часов · школьники · общеразвивающая' })
    .click();
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Сервер недоступен' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('LIVE · Данные сервера')).toBeVisible();
  await expect(page.getByLabel('Запрос методиста')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Сервер недоступен' })).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await page.getByLabel('Запрос методиста').fill('Курс Python для школьников на 17 часов');
  await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Сервер недоступен' })).toBeVisible();
  expect(ids).toHaveLength(3);
  expect(ids[2]).not.toBe(ids[1]);
  await expect(page.getByRole('heading', { name: 'Ваши сохранённые курсы' })).toHaveCount(0);
});

test('PDF/DOCX в demo показывают недоступность реальной обработки', async ({ page }) => {
  await page
    .getByLabel('Загрузить PDF или DOCX')
    .setInputFiles(path.resolve('../../6aa380dc-cb63-4bbe-9f91-41943b00d8c8.docx'));
  await expect(
    page.getByRole('alert').filter({ hasText: 'извлечение PDF/DOCX требует backend' }),
  ).toBeVisible();
  await expect(page.getByText('Текст получен', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(reports, 'create-1440.png') });
});
