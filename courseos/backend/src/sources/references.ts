import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import mammoth from 'mammoth';

export const referenceTextLimit = 12000;
const responseLimit = 2 * 1024 * 1024;

export function extractedReference(name: string, text: string, url = '', warnings: string[] = []) {
  const originalLength = text.length;
  const transmitted = text.slice(0, referenceTextLimit);
  return {
    id: randomUUID(),
    name,
    text: transmitted,
    url,
    status: transmitted.trim() ? 'provided' : 'unconfirmed',
    coordinate: 'Извлечённый текст; координаты страниц не сохранены',
    claim: '',
    checked_at: new Date().toISOString(),
    scope: [
      ...warnings,
      `Получено ${originalLength} символов, в генерацию передаётся ${transmitted.length}; лимит ${referenceTextLimit}.`,
      !transmitted.trim()
        ? 'Текст не извлечён. Для скана нужен OCR, который не поддерживается.'
        : 'Достоверность текста не подтверждена.',
    ].join(' '),
    hash: createHash('sha256').update(transmitted).digest('hex'),
    extraction: {
      status: transmitted.trim() ? 'extracted' : 'failed',
      original_chars: originalLength,
      transmitted_chars: transmitted.length,
      truncated: originalLength > transmitted.length,
      warnings,
    },
  };
}

export async function extractUpload(name: string, buffer: Buffer) {
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Файл превышает 8 МБ.');
  if (/\.docx$/i.test(name)) {
    const result = await mammoth.extractRawText({ buffer });
    return extractedReference(
      name,
      result.value,
      '',
      result.messages.map((m) => m.message),
    );
  }
  if (/\.pdf$/i.test(name)) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    const document = await loading.promise;
    try {
      const pages: string[] = [];
      const count = Math.min(document.numPages, 100);
      for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      }
      return extractedReference(
        name,
        pages.join('\n'),
        '',
        count < document.numPages ? ['Извлечены только первые 100 страниц.'] : [],
      );
    } finally {
      await loading.destroy();
    }
  }
  throw new Error('Поддерживаются PDF и DOCX.');
}

function publicAddress(address: string) {
  if (address.includes(':'))
    return /^2[0-9a-f]{3}:/i.test(address) && !/^2001:(db8|0):/i.test(address);
  const [a, b] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 198
  );
}

async function validatePublicUrl(url: URL) {
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new Error('Нужен публичный HTTP(S) URL без реквизитов и нестандартного порта.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
    throw new Error('Локальные и служебные адреса запрещены.');
  return addresses;
}

// Подключаемся к уже проверенному адресу: повторное DNS-разрешение не должно
// позволять публичному имени перенаправить запрос во внутреннюю сеть.
const publicFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const addresses = await validatePublicUrl(url);
  const address = addresses[0].address;
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        signal: init?.signal ?? undefined,
        ...{ autoSelectFamily: false },
        lookup: (_hostname, _options, callback) => callback(null, address, isIP(address)),
        headers: { 'User-Agent': 'CourseOS-SourceCheck/1.0', Accept: 'text/html,text/plain' },
      },
      (response) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers))
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        const status = response.statusCode ?? 502;
        resolve(
          new Response(
            [204, 205, 304].includes(status)
              ? null
              : (Readable.toWeb(response) as ReadableStream<Uint8Array>),
            { status, headers },
          ),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
};

export interface SourceEvidence {
  original_url: string;
  final_url: string;
  checked_at: string;
  availability: 'available' | 'unavailable';
  http_status: number | null;
  claim: string;
  content_status: 'supported_excerpt' | 'not_supported' | 'unverified';
  excerpt: string;
  reason: string;
}

export async function checkSource(
  originalUrl: string,
  claim = '',
  evidenceQuote = '',
  fetcher: typeof fetch = publicFetch,
) {
  const evidence: SourceEvidence = {
    original_url: originalUrl,
    final_url: originalUrl,
    checked_at: new Date().toISOString(),
    availability: 'unavailable',
    http_status: null,
    claim,
    content_status: 'unverified',
    excerpt: '',
    reason: '',
  };
  try {
    let url = new URL(originalUrl);
    const signal = AbortSignal.timeout(15000);
    for (let redirect = 0; redirect <= 4; redirect++) {
      await validatePublicUrl(url);
      const response = await fetcher(url, { redirect: 'manual', signal });
      evidence.final_url = url.href;
      evidence.http_status = response.status;
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || redirect === 4)
          throw new Error('Слишком много перенаправлений или отсутствует Location.');
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      evidence.availability = 'available';
      if (
        !/text\/(html|plain)|application\/xhtml/i.test(response.headers.get('content-type') ?? '')
      ) {
        await response.body?.cancel();
        throw new Error('Страница доступна, но формат не поддерживает проверку текста.');
      }
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > responseLimit) {
          await reader.cancel();
          throw new Error('Страница превышает лимит 2 МБ; содержание не проверено.');
        }
        chunks.push(part.value);
      }
      const html = Buffer.concat(chunks).toString('utf8');
      const text = html
        .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim();
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
      const quote = evidenceQuote.trim();
      if (claim.trim() && quote.length >= 30 && normalize(text).includes(normalize(quote))) {
        evidence.content_status = 'supported_excerpt';
        evidence.excerpt = quote;
        evidence.reason =
          'Указанный фрагмент найден на странице. Связь фрагмента с утверждением и достоверность требуют решения методиста.';
      } else {
        evidence.content_status = claim.trim() ? 'not_supported' : 'unverified';
        evidence.reason = claim.trim()
          ? 'Подтверждающий фрагмент не предоставлен или не найден. HTTP-ответ не подтверждает утверждение.'
          : 'Доступность проверена; конкретное утверждение и подтверждающий фрагмент не заданы.';
      }
      return { ...extractedReference(url.hostname, text, originalUrl), verification: evidence };
    }
  } catch (error) {
    evidence.reason = error instanceof Error ? error.message : String(error);
  }
  return { ...extractedReference(originalUrl, '', originalUrl), verification: evidence };
}

export async function checkGeneratedLinks(material: unknown) {
  const text = JSON.stringify(material);
  const urls = [...new Set(text.match(/https?:\/\/[^\s"<>\\)]+/g) ?? [])];
  const checks: SourceEvidence[] = [];
  for (const url of urls.slice(0, 12)) {
    const position = text.indexOf(url);
    const claim = text.slice(
      Math.max(0, position - 200),
      Math.min(text.length, position + url.length + 200),
    );
    checks.push((await checkSource(url, claim)).verification);
  }
  if (urls.length > 12)
    checks.push({
      original_url: '',
      final_url: '',
      checked_at: new Date().toISOString(),
      availability: 'unavailable',
      http_status: null,
      claim: '',
      content_status: 'unverified',
      excerpt: '',
      reason: `Проверены первые 12 из ${urls.length} ссылок; остальные требуют ручной проверки.`,
    });
  return checks;
}
