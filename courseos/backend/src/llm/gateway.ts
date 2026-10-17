import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { callCost, routes, type ModelId, type StepId } from './models.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CallUsage {
  step: StepId;
  model: ModelId;
  prompt_tokens: number;
  completion_tokens: number;
  cost_rub: number;
  duration_ms: number;
  cached: boolean;
}

export interface CallLogEntry extends CallUsage {
  at: string;
  status: 'ok' | 'error';
  error?: string;
}

export type LlmErrorCode =
  'unavailable' | 'rate_limited' | 'timeout' | 'upstream' | 'rejected' | 'empty';

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
  }
}

export interface GatewayOptions {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  dataDir: string;
  maxConcurrency?: number;
  // Подменяется в тестах, чтобы не тратить дневной лимит команды.
  fetch?: typeof fetch;
  retryDelaysMs?: number[];
}

// Шлюз обрывает запрос через 120 с; ждём чуть меньше, чтобы ошибка была нашей и понятной.
const requestTimeoutMs = 118_000;

export class LlmGateway {
  private readonly options: GatewayOptions;
  private readonly fetch: typeof fetch;
  private readonly maxConcurrency: number;
  private readonly retryDelaysMs: number[];
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(options: GatewayOptions) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
    // Шлюз отвечает 429 на третий одновременный запрос команды.
    this.maxConcurrency = options.maxConcurrency ?? 2;
    this.retryDelaysMs = options.retryDelaysMs ?? [2_000, 6_000];
  }

  get available() {
    return Boolean(this.options.baseUrl && this.options.apiKey);
  }

  get logPath() {
    return join(this.options.dataDir, 'llm-calls.jsonl');
  }

  // jsonSchema включает structured output шлюза (vLLM guided decoding): ответ гарантированно
  // разбирается как JSON по схеме. GigaChat-3-Pro без неё иногда теряет скобку или ключ.
  async chat(
    step: StepId,
    messages: ChatMessage[],
    options: { jsonSchema?: { name: string; schema: object } } = {},
  ): Promise<{ content: string; usage: CallUsage }> {
    if (!this.available)
      throw new LlmError(
        'unavailable',
        'Модель не настроена: нет OPENAI_BASE_URL или OPENAI_API_KEY.',
      );
    const route = routes[step];
    const body = {
      model: route.model,
      temperature: route.temperature,
      max_tokens: route.maxTokens,
      ...(options.jsonSchema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: { ...options.jsonSchema, strict: true },
            },
          }
        : {}),
      messages,
    };
    // Одинаковый запрос не оплачиваем повторно: ответ берётся из сохранённого результата.
    const cachePath = join(
      this.options.dataDir,
      'cache',
      `${createHash('sha256').update(JSON.stringify(body)).digest('hex')}.json`,
    );
    const cached = await readFile(cachePath, 'utf8').then(
      (text) => JSON.parse(text) as { content: string; usage: CallUsage },
      () => null,
    );
    if (cached) {
      const usage = { ...cached.usage, cost_rub: 0, duration_ms: 0, cached: true };
      await this.log({ ...usage, at: new Date().toISOString(), status: 'ok' });
      return { content: cached.content, usage };
    }

    const started = Date.now();
    try {
      const response = await this.withSlot(() => this.requestWithRetries(body));
      const content = response.choices?.[0]?.message?.content;
      const usage: CallUsage = {
        step,
        model: route.model,
        prompt_tokens: response.usage?.prompt_tokens ?? 0,
        completion_tokens: response.usage?.completion_tokens ?? 0,
        cost_rub: 0,
        duration_ms: Date.now() - started,
        cached: false,
      };
      usage.cost_rub = callCost(route.model, usage.prompt_tokens, usage.completion_tokens);
      // Рассуждающая модель при нехватке max_tokens тратит всё на рассуждение и отдаёт null.
      if (!content?.trim()) {
        await this.log({ ...usage, at: new Date().toISOString(), status: 'error', error: 'empty' });
        throw new LlmError('empty', 'Модель вернула пустой ответ. Попробуйте ещё раз.');
      }
      await mkdir(join(this.options.dataDir, 'cache'), { recursive: true });
      await writeFile(cachePath, JSON.stringify({ content, usage }));
      await this.log({ ...usage, at: new Date().toISOString(), status: 'ok' });
      return { content, usage };
    } catch (error) {
      if (error instanceof LlmError && error.code === 'empty') throw error;
      const failure = error instanceof LlmError ? error : new LlmError('upstream', String(error));
      await this.log({
        step,
        model: route.model,
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_rub: 0,
        duration_ms: Date.now() - started,
        cached: false,
        at: new Date().toISOString(),
        status: 'error',
        error: failure.code,
      });
      throw failure;
    }
  }

  async readLog(): Promise<CallLogEntry[]> {
    const text = await readFile(this.logPath, 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CallLogEntry);
  }

  private async requestWithRetries(body: object): Promise<ChatCompletion> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(body);
      } catch (error) {
        // 429 бывает и от третьего одновременного запроса, и от исчерпанного дневного лимита;
        // различить их по ответу нельзя, поэтому повторяем коротко и сдаёмся.
        const retryable =
          error instanceof LlmError && ['rate_limited', 'upstream', 'timeout'].includes(error.code);
        if (!retryable || attempt >= this.retryDelaysMs.length) throw error;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelaysMs[attempt]));
      }
    }
  }

  private async request(body: object): Promise<ChatCompletion> {
    let response: Response;
    try {
      response = await this.fetch(`${this.options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError')
        throw new LlmError('timeout', 'Модель не ответила за 2 минуты.');
      throw new LlmError('upstream', 'Шлюз модели недоступен.');
    }
    if (response.status === 429)
      throw new LlmError(
        'rate_limited',
        'Шлюз модели отклонил запрос: исчерпан дневной лимит команды или слишком много одновременных запросов.',
      );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // 4xx кроме 429 означает ошибку в нашем запросе: повтор не поможет.
      throw new LlmError(
        response.status >= 500 ? 'upstream' : 'rejected',
        `Шлюз модели ответил ${response.status}: ${detail.slice(0, 300)}`,
      );
    }
    return (await response.json()) as ChatCompletion;
  }

  private async withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrency)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async log(entry: CallLogEntry) {
    await mkdir(this.options.dataDir, { recursive: true });
    await appendFile(this.logPath, `${JSON.stringify(entry)}\n`);
  }
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
