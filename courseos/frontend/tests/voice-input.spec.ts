import { test, expect } from '@playwright/test';

// Настоящее распознавание требует микрофона и сервиса браузера, поэтому подменяем API:
// после start() фейк отдаёт промежуточную фразу, затем окончательную.
const fakeRecognition = () => {
  class FakeRecognition {
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      const result = (transcript: string, isFinal: boolean) =>
        Object.assign([{ transcript, confidence: 1 }], { isFinal });
      setTimeout(() => this.onresult?.({ results: [result('для учителей', false)] }), 50);
      setTimeout(() => this.onresult?.({ results: [result('для учителей физики', true)] }), 100);
    }
    stop() {
      setTimeout(() => this.onend?.(), 0);
    }
    abort() {
      this.stop();
    }
  }
  Object.assign(window, {
    SpeechRecognition: FakeRecognition,
    webkitSpeechRecognition: FakeRecognition,
  });
};

test('Диктовка дописывает текст к запросу', async ({ page }) => {
  await page.addInitScript(fakeRecognition);
  await page.goto('/');
  const request = page.getByLabel('Запрос методиста');
  await request.fill('Курс по ИИ');
  const mic = page.getByRole('button', { name: /Нажмите и удерживайте/ });
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  // Короткий клик оставляет запись включённой до следующего клика.
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect(request).toHaveValue('Курс по ИИ для учителей физики');
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await expect(request).toHaveValue('Курс по ИИ для учителей физики');
});

test('Без Web Speech API кнопки микрофона нет', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Добавить материалы' })).toBeVisible();
  await expect(page.locator('.dictation-button')).toHaveCount(0);
});
