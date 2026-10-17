import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSource, extractedReference, extractUpload } from '../src/sources/references.ts';

const url = 'https://93.184.216.34/';
const quote = 'Python supports multiple programming paradigms and dynamic typing';
const page: typeof fetch = async () =>
  new Response(`<html><body>${quote}</body></html>`, { headers: { 'Content-Type': 'text/html' } });

test('HTTP 200 не подтверждает утверждение без найденного фрагмента', async () => {
  const result = await checkSource(
    url,
    'Все программы Python работают быстрее C',
    'Другой фрагмент, который отсутствует на странице полностью',
    page,
  );
  assert.equal(result.verification.availability, 'available');
  assert.equal(result.verification.content_status, 'not_supported');
  assert.equal(result.verification.excerpt, '');
  assert.equal(result.verification.original_url, url);
  assert.ok(result.verification.checked_at);
});
test('сохраняет найденный фрагмент без автоматического признания достоверности', async () => {
  const result = await checkSource(url, 'Python поддерживает динамическую типизацию', quote, page);
  assert.equal(result.verification.content_status, 'supported_excerpt');
  assert.equal(result.verification.excerpt, quote);
  assert.equal(result.status, 'provided');
});
test('сохраняет недоступность и запрещает служебные URL до запроса', async () => {
  const missing = await checkSource(
    url,
    'Утверждение',
    '',
    async () => new Response('', { status: 404 }),
  );
  assert.equal(missing.verification.http_status, 404);
  assert.equal(missing.verification.availability, 'unavailable');
  const blocked = await checkSource('http://127.0.0.1/', '', '', async () => {
    throw new Error('Запрос не должен выполняться');
  });
  assert.match(blocked.verification.reason, /служебные/);
});
test('проверяет адрес перенаправления', async () => {
  const result = await checkSource(
    url,
    '',
    '',
    async () =>
      new Response('', {
        status: 302,
        headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
      }),
  );
  assert.match(result.verification.reason, /служебные/);
});
test('обрезание и ошибки извлечения видимы, пустой текст не считается извлечённым', async () => {
  assert.deepEqual(extractedReference('Большой', 'a'.repeat(13000)).extraction, {
    status: 'extracted',
    original_chars: 13000,
    transmitted_chars: 12000,
    truncated: true,
    warnings: [],
  });
  assert.equal(extractedReference('Скан', '').extraction.status, 'failed');
  await assert.rejects(extractUpload('broken.docx', Buffer.from('broken')));
});
