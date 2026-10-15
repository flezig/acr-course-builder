import { z } from 'zod';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
const messages: Record<number, string> = {
  401: 'Нужна авторизация на сервере.',
  403: 'Нет доступа к этому курсу.',
  409: 'Версия изменилась. Обновите данные и создайте новый план правки.',
  413: 'Файл превышает разрешённый сервером размер.',
  422: 'Проверьте параметры запроса.',
  429: 'Лимит запросов исчерпан. Повторите действие позже.',
};
export class HttpTransport {
  constructor(private baseUrl: string) {}
  async request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...init?.headers,
        },
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new ApiError(
        0,
        'Сервер недоступен или превышено время ожидания. Результат операции пока неизвестен; повтор использует прежний ID.',
      );
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const detail = z.object({ detail: z.string() }).safeParse(body);
      throw new ApiError(
        response.status,
        detail.success
          ? detail.data.detail
          : messages[response.status] ||
            'Ошибка сервера. Сохранённые результаты доступны после восстановления.',
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(
        502,
        'Сервер не вернул JSON по контракту CourseOS. Проверьте адрес API и доступность backend.',
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success)
      throw new ApiError(
        502,
        'Ответ сервера не соответствует контракту CourseOS. Данные не приняты.',
      );
    return parsed.data;
  }
  async file(path: string): Promise<Blob> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        credentials: 'include',
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new ApiError(0, 'Не удалось получить файл.');
    }
    if (!response.ok)
      throw new ApiError(response.status, messages[response.status] || 'Файл недоступен.');
    return response.blob();
  }
}
