import type { Requirements } from './schema';

export type Reference = Requirements['references'][number];

export function referenceUrlError(url: string): string | undefined {
  if (!url.trim()) return;
  try {
    if (['https:', 'http:'].includes(new URL(url.trim()).protocol)) return;
  } catch {
    // Неполная ссылка получает ту же подсказку, что и неподдерживаемый протокол.
  }
  return 'Введите полную ссылку, например https://example.com.';
}

export function userReference({
  id = crypto.randomUUID(),
  name,
  text = '',
  url = '',
}: {
  id?: string;
  name: string;
  text?: string;
  url?: string;
}): Reference {
  const hasText = !!text.trim();
  return {
    id,
    name,
    text,
    url,
    status: hasText ? 'provided' : 'unconfirmed',
    coordinate: hasText ? 'Вставленный фрагмент; координаты в оригинале не указаны' : '',
    claim: 'Ввод пользователя; применимость к результатам требует проверки',
    checked_at: '',
    scope: url.trim()
      ? 'Содержимое URL не загружено; выполнена только регистрация ссылки'
      : 'Сохранён фактический текст без подтверждения достоверности',
    // Хеш рассчитывается при сохранении, когда методист закончил ввод текста.
    hash: '',
    provenance: {
      origin: hasText ? 'user_text' : 'url',
      access: hasText ? 'available' : 'registered',
      content: 'unverified',
      extent: hasText ? 'excerpt' : 'none',
      authors: '',
      year: '',
      title: name,
      doi: '',
      study_type: '',
      population: '',
      result: '',
    },
  };
}
