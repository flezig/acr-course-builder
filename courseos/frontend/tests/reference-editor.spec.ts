import { answerDemoQuestions } from './answer-demo-questions';
import { expect, test, type Page } from '@playwright/test';
import type { Snapshot } from '../src/entities/course/model/schema';
import { auditSnapshot } from '../src/entities/course/model/rules';
import { rationaleCoverage } from '../src/entities/course/model/rationale';
import { generalRequirements } from '../src/entities/course/model/checklist';

async function latestSnapshot(page: Page): Promise<Snapshot> {
  const courseId = page.url().match(/courses\/([^/]+)/)![1];
  return page.evaluate((id) => {
    const stored = JSON.parse(localStorage.getItem('courseos-demo-v1')!);
    return stored.courses[id].snapshots.at(-1);
  }, courseId);
}

for (const verified of [false, true]) {
  test(`Референс на карте результатов: ${verified ? 'сверен с оригиналом' : 'без отметки'}`, async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Первые шаги в Python 16 часов/ }).click();
    await page.getByRole('button', { name: 'Отправить запрос', exact: true }).click();
    await answerDemoQuestions(page);
    await expect(page.locator('.verdict')).toBeVisible();
    await page.getByRole('link', { name: 'Карта результатов', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить текст, PDF, DOCX или ссылку' }).click();
    const checkbox = page.getByRole('checkbox', { name: 'Текст сверен с оригиналом' });
    const text = page.getByLabel('Текст референса', { exact: true });
    await expect(checkbox).toBeDisabled();
    await expect(page.getByText('Происхождение и проверка фрагмента')).toHaveCount(0);
    await expect(page.getByLabel('Координаты в оригинале')).toHaveCount(0);
    await expect(page.getByLabel('Какое утверждение поддерживает фрагмент')).toHaveCount(0);
    await text.fill('   ');
    await expect(checkbox).toBeDisabled();
    await text.fill('Учебный фрагмент: условия и циклы в Python.');
    await expect(checkbox).toBeEnabled();
    await checkbox.check();
    await text.fill('Учебный фрагмент: переменные, условия и циклы в Python.');
    await expect(checkbox).not.toBeChecked();
    if (verified) await checkbox.check();
    await page.getByLabel('Название источника').fill('Проверка референса');
    await checkbox
      .locator('..')
      .screenshot({ path: testInfo.outputPath('reference-checkbox.png') });
    await page.getByRole('button', { name: 'Добавить источник', exact: true }).click();
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeDisabled();
    const card = page.locator('details.source').filter({ hasText: 'Проверка референса' });
    await card.locator('summary').click();
    await expect(card).toContainText(
      verified ? 'Текст сверен с оригиналом.' : 'Текст ещё не сверен с оригиналом.',
    );
    await expect(card).not.toContainText(/user_text|available|unverified|confirmed/);
    await page.getByRole('button', { name: 'Сохранить основания в новой ревизии' }).click();
    await expect(
      page.getByRole('button', { name: 'Добавить текст, PDF, DOCX или ссылку' }),
    ).toBeVisible();
    const snapshot = await latestSnapshot(page);
    const source = snapshot.sources.find((source) => source.name === 'Проверка референса')!;
    expect(source.status).toBe('provided');
    expect(source.coordinate).toBe('Вставленный фрагмент; координаты в оригинале не указаны');
    expect(source.claim).toBe('Ввод пользователя; применимость к результатам требует проверки');
    expect(source.provenance).toMatchObject({
      access: verified ? 'read' : 'available',
      content: verified ? 'confirmed' : 'unverified',
    });
    if (verified) expect(Date.parse(source.checked_at)).toBeGreaterThan(0);
    else expect(source.checked_at).toBe('');
    expect(snapshot.audit.issues.some((issue) => issue.id === `source-${source.id}`)).toBe(
      !verified,
    );
    const legacy = structuredClone(snapshot);
    for (const references of [legacy.sources, legacy.skeleton.requirements.references]) {
      const reference = references.find((reference) => reference.id === source.id)!;
      reference.provenance!.access = 'read';
      reference.checked_at = new Date().toISOString();
    }
    // Прежнее промежуточное состояние не меняет проверки и не подтверждает применимость.
    expect(auditSnapshot(legacy)).toEqual({ ...auditSnapshot(snapshot), at: expect.any(String) });
    expect(rationaleCoverage(legacy.skeleton)).toEqual(rationaleCoverage(snapshot.skeleton));
    expect(generalRequirements(legacy)).toEqual(generalRequirements(snapshot));
    await page.getByRole('link', { name: 'Проверка программы', exact: true }).click();
    await expect(
      page.getByText('Решения опираются на достоверные источники', { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator('.checklist-item')
        .filter({ hasText: 'Решения опираются на достоверные источники' }),
    ).toContainText('Проверяет методист');
    await page.reload();
    expect((await latestSnapshot(page)).sources.find((item) => item.id === source.id)).toEqual(
      source,
    );
  });
}
