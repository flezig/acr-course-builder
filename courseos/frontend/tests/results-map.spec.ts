import { test, expect, type Page } from '@playwright/test';
import type { Skeleton } from '../src/entities/course/model/schema';

async function openMap(page: Page, preset = 'python') {
  await page.goto('/');
  await page
    .getByRole('button', {
      name:
        preset === 'python'
          ? 'Первые шаги в Python 16 часов · школьники · общеразвивающая'
          : 'ИИ в работе учителя 36 часов · учителя · повышение квалификации',
    })
    .click();
  await page.getByRole('button', { name: 'Создать каркас', exact: true }).click();
  await expect(page).toHaveURL(/courses\//);
  const id = page.url().match(/courses\/([^/]+)/)![1];
  await page.goto(`/courses/${id}/map`);
  await expect(page.locator('.outcome-list-item')).toHaveCount(preset === 'python' ? 3 : 5);
  return id;
}

async function fixture(page: Page, id: string, fixture: 'gaps' | 'shared' | 'large' | 'empty') {
  await page.evaluate(
    ({ id, fixture }) => {
      const db = JSON.parse(localStorage.getItem('courseos-demo-v1')!);
      const s = db.courses[id].snapshots.at(-1).skeleton as Skeleton;
      if (fixture === 'gaps') {
        const outcome = s.outcomes[0].id;
        for (const collection of [s.topics, s.activities, s.assessments])
          collection.forEach((item) => {
            item.outcome_ids = item.outcome_ids.filter((i) => i !== outcome);
          });
      }
      if (fixture === 'shared') {
        s.topics[0].outcome_ids = s.outcomes.slice(0, 2).map((o) => o.id);
        s.assessments[0].outcome_ids = s.outcomes.slice(0, 2).map((o) => o.id);
        // A topic association alone must never imply an outcome-to-assessment link.
        s.assessments[0].topic_id = s.topics[2].id;
        s.activities.push({
          ...s.activities[0],
          id: 'orphan-activity',
          outcome_ids: [],
          description: 'Отдельная несвязанная практика',
        });
      }
      if (fixture === 'large') {
        for (let i = 0; i < 48; i++)
          s.outcomes.push({
            ...s.outcomes[0],
            id: `extra-${i}`,
            description: `Дополнительный результат ${i}: ${'ДлинноеНазвание'.repeat(18)}`,
          });
        for (let i = 0; i < 16; i++)
          s.topics.push({
            ...s.topics[0],
            id: `extra-topic-${i}`,
            title: `Тема ${i}: ${'Очень длинное название '.repeat(10)}`,
          });
      }
      if (fixture === 'empty') {
        s.outcomes = [];
        s.topics = [];
        s.activities = [];
        s.assessments = [];
        s.requirements.request = '';
        s.requirements.references = [];
      }
      localStorage.setItem('courseos-demo-v1', JSON.stringify(db));
    },
    { id, fixture },
  );
  await page.reload();
}
const panel = (page: Page) => page.getByRole('complementary', { name: 'Детали карточки' });

test('Результат — точка входа; обучение и оценивание рядом, полные тексты доступны', async ({
  page,
}) => {
  const id = await openMap(page, 'teachers');
  const original = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem('courseos-demo-v1')!).courses[id].snapshots.at(-1).skeleton,
    id,
  );
  await expect(page.locator('.outcome-list-item[aria-current=true]')).toContainText(
    'Риски, этика и данные детей',
  );
  await expect(page.getByLabel('Связанное обучение')).toBeVisible();
  await expect(page.getByLabel('Связанное оценивание')).toBeVisible();
  await expect(page.locator('.full-outcome-text')).toHaveText(original.outcomes[0].description);
  await expect(page.locator('.map-lines')).toHaveCount(0);
  await expect(page.getByLabel('Масштаб', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Связи есть', { exact: true })).toHaveCount(0);
  await expect(page.getByText('решение и объяснение', { exact: false })).toHaveCount(0);
  await page.locator('.assessment-column .chain-card').first().click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'Полная формулировка' })).toBeVisible();
  await expect(panel(page)).toContainText(original.assessments[0].action);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    panel(page).getByRole('button', { name: 'Настроить связи', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть детали' }).click();
  await expect(page.locator('.assessment-column .chain-card').first()).toBeFocused();
  await page.locator('.requirement-context').click();
  await expect(panel(page)).toContainText(original.requirements.request);
  await page.getByRole('button', { name: 'Закрыть детали' }).click();
  await page.locator('.outcome-list-item').nth(2).click();
  await expect(page.locator('.selected-result-heading')).toContainText('Результат 03 из 5');
  await page.screenshot({ path: '../reports/results-outcome-workspace.png', fullPage: true });
  expect(
    await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem('courseos-demo-v1')!).courses[id].snapshots.at(-1).skeleton,
      id,
    ),
  ).toEqual(original);
});

test('Поиск раскрывает окружение объекта; тип, причины пробелов и пустая выдача явны', async ({
  page,
}) => {
  await openMap(page);
  await page.getByLabel('Тип результата').selectOption('skill');
  await expect(page.locator('.outcome-list-item')).toHaveCount(1);
  await expect(page.locator('.result-formulation')).toContainText('Применяет условия');
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await page.getByLabel('Поиск по карте').fill('Циклы и повторение');
  await expect(page.locator('.outcome-list-item')).toHaveCount(1);
  await expect(page.getByLabel('Найденные объекты')).toBeVisible();
  await page.getByLabel('Найденные объекты').getByRole('button').first().click();
  await expect(panel(page)).toContainText('Циклы и повторение');
  await page.getByRole('button', { name: 'Закрыть детали' }).click();
  await page.getByLabel('Поиск по карте').fill('несуществующий объект 9384');
  await expect(page.getByRole('heading', { name: 'Ничего не найдено' })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await page.getByLabel('Пробелы в связях').selectOption('problems');
  await expect(page.getByText('Пробелов в связях не найдено')).toBeVisible();
  await page.getByRole('button', { name: 'Показать все результаты' }).click();
  await expect(page.locator('.outcome-list-item')).toHaveCount(3);
});

test('Полная карта: компактные карточки, прямые связи по выбору и отдельное включение всех линий', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openMap(page, 'teachers');
  await page.getByRole('button', { name: 'Показать всю карту' }).click();
  await expect(page.locator('.map-card')).toHaveCount(27);
  await page
    .locator('.results-workspace')
    .screenshot({ path: '../reports/results-map-workspace.png' });

  await expect(page.locator('.map-lines path')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Сбросить выделение' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Все линии' }).check();
  await expect(page.locator('.map-lines path')).toHaveCount(40);
  await page.getByRole('checkbox', { name: 'Все линии' }).uncheck();
  await expect(page.locator('.map-lines path')).toHaveCount(0);
  const zoom = page.getByLabel('Масштаб', { exact: true });
  const before = parseInt(await zoom.innerText());
  await page.getByRole('button', { name: 'Увеличить масштаб' }).click();
  expect(parseInt(await zoom.innerText())).toBeGreaterThan(before);
  const card = page.locator('.map-card').filter({ hasText: 'Риски, этика и данные детей' }).first();
  await card.click();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.map-lines path.active')).toHaveCount(6);
  await expect(page.locator('.map-lines path.muted')).toHaveCount(0);
  await expect(page.locator('.map-card.dimmed')).not.toHaveCount(0);
  await expect(page.locator('.map-lines path.active').first()).toHaveAttribute(
    'marker-end',
    /map-arrow-active/,
  );
  const scale = await zoom.innerText();
  const position = await page
    .locator('.map-viewport')
    .evaluate((el) => [el.scrollLeft, el.scrollTop]);
  await page.getByRole('button', { name: 'Закрыть детали' }).click();
  await expect(zoom).toHaveText(scale);
  expect(
    await page.locator('.map-viewport').evaluate((el) => [el.scrollLeft, el.scrollTop]),
  ).toEqual(position);
  await expect(page.locator('.map-lines path')).toHaveCount(0);
  await page.screenshot({ path: '../reports/results-full-map-clean.png', fullPage: true });

  await page.getByRole('button', { name: 'Вписать в экран' }).click();
  await page.getByRole('button', { name: 'К результатам' }).click();
  await expect(page.locator('.outcome-list-item[aria-current=true]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Пробелы сохраняют контекст; общая оценка добавляется явным действием в новой ревизии', async ({
  page,
}) => {
  const id = await openMap(page);
  await fixture(page, id, 'gaps');
  await expect(page.locator('.outcome-list-item').first()).toContainText(
    'Нет обучения · Нет оценивания',
  );
  await expect(page.getByLabel('Сводка результатов')).toContainText('Требуют проверки: 1');
  await page.getByLabel('Пробелы в связях').selectOption('assessment');
  await expect(page.locator('.outcome-list-item')).toHaveCount(1);
  await expect(page.locator('.result-requirements')).toContainText('Исходный запрос');
  await page.getByRole('button', { name: 'Добавить проверку' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox').nth(2).check();
  await dialog.getByRole('button', { name: /^Темы/ }).click();
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByRole('button', { name: /^Практика/ }).click();
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByRole('button', { name: 'Сохранить связи' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ничего не найдено' })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(page.locator('.outcome-list-item').first()).not.toContainText('Нет оценивания');
  const stored = await page.evaluate((id) => {
    const course = JSON.parse(localStorage.getItem('courseos-demo-v1')!).courses[id];
    return {
      version: course.snapshots.at(-1).course_version,
      approved: course.snapshots.at(-1).approval_applicable,
      outcomes: course.snapshots.at(-1).skeleton.assessments[2].outcome_ids,
    };
  }, id);
  expect(stored).toEqual({ version: 2, approved: false, outcomes: ['outcome-2', 'outcome-1'] });
  await page.reload();
  await expect(page.locator('.outcome-list-item').first()).not.toContainText('Нет оценивания');
  await page.screenshot({ path: '../reports/results-with-gaps.png', fullPage: true });
});

test('Общие элементы показывают все прямые связи; topic_id не создаёт покрытие результата', async ({
  page,
}) => {
  const id = await openMap(page);
  await fixture(page, id, 'shared');
  const assessment = page.locator('.assessment-column .chain-card').first();
  await expect(assessment).toContainText('2 результата');
  await assessment.click();
  const linkedResults = panel(page).getByRole('region', { name: 'Связанные результаты' });
  await expect(linkedResults.getByRole('button')).toHaveCount(2);
  await expect(panel(page).getByRole('region', { name: 'Связанные обучение' })).toContainText(
    'Условия и выбор',
  );
  await linkedResults.getByRole('button').last().click();
  await expect(page.locator('.outcome-list-item[aria-current=true]')).toContainText(
    'Применяет условия',
  );
  await page.getByRole('button', { name: 'Закрыть детали' }).click();
  await expect(page.locator('.assessment-column')).toContainText(
    'Прослеживает значение переменной',
  );
  await page.locator('.outcome-list-item').nth(2).click();
  await expect(page.locator('.assessment-column')).not.toContainText(
    'Прослеживает значение переменной',
  );
  await page
    .getByLabel('Сводка результатов')
    .getByRole('button', { name: /объектов без результатов/ })
    .click();
  await expect(page.getByLabel('Пробелы в связях')).toHaveValue('unlinked');
  await page
    .getByLabel('Объекты без результатов', { exact: true })
    .getByRole('button', { name: /Отдельная несвязанная практика/ })
    .click();
  await expect(panel(page)).toContainText('Не связан с результатами');
  await expect(panel(page)).toContainText('Связей пока нет.');
  await panel(page).getByRole('button', { name: 'Привязать результат', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').first().check();
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить связи' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await page.locator('.outcome-list-item').first().click();
  await expect(page.locator('.learning-column')).toContainText('Отдельная несвязанная практика');
});

test('Большие списки, длинные названия, мобильный экран, клавиатура и reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const id = await openMap(page);
  await fixture(page, id, 'large');
  await expect(page.locator('.outcome-list-item')).toHaveCount(51);
  const topicList = page.getByRole('region', { name: 'Темы', exact: true });
  await expect(topicList.locator('summary')).toContainText('Все 19');
  await topicList.locator('summary').click();
  await expect(topicList.locator('.chain-card')).toHaveCount(19);
  await topicList.locator('.chain-card').last().click();
  await expect(panel(page)).toContainText('Очень длинное название');
  await page.getByRole('button', { name: 'Закрыть детали' }).click();
  await page.getByLabel('Поиск по карте').fill('Дополнительный результат 47:');
  await expect(page.locator('.outcome-list-item')).toHaveCount(1);
  await expect(page.locator('.result-formulation')).toContainText('Нет обучения · Нет оценивания');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Подробности результата' }).click();
  await expect(panel(page)).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть детали' }).click();
  await expect(page.getByRole('button', { name: 'Подробности результата' })).toBeFocused();
  await page.screenshot({ path: '../reports/results-mobile-workspace.png', fullPage: true });
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await page.getByRole('button', { name: 'Показать всю карту' }).click();
  await expect(page.locator('.map-card')).toHaveCount(89);
  await expect(page.locator('.map-lines path')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Пустая программа и архивная ревизия доступны без неработающих действий', async ({ page }) => {
  const id = await openMap(page);
  await page.getByRole('button', { name: 'Настроить связи', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').first().uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить связи' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByLabel('Версия курса').locator('option:checked')).toHaveText(
    'Актуальная 2',
  );
  await page.goto(`/courses/${id}/map?version=1`);
  await expect(page.locator('.outcome-list-item')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Настроить связи', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Подробности результата' }).click();
  await expect(panel(page)).toContainText('Эта ревизия доступна для просмотра.');
  await expect(
    panel(page).getByRole('button', { name: 'Настроить связи', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Закрыть детали' }).click();
  await page.goto(`/courses/${id}/map`);
  await fixture(page, id, 'empty');
  await expect(
    page.getByRole('heading', { name: 'В программе пока нет результатов' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать каркас', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Редактирование каркаса' })).toBeVisible();
});
