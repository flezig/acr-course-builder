import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { z } from 'zod';
import { AgentRunner, agentRequestSchema } from './agent/run-agent.ts';
import { LlmError, LlmGateway, type LlmErrorCode } from './llm/gateway.ts';
import { routes } from './llm/models.ts';
import { clarifyQuestions, questionsInputSchema } from './steps/clarify-questions.ts';
import { draftSkeleton, skeletonInputSchema } from './steps/draft-skeleton.ts';
import {
  finalInputSchema,
  generateCourseTest,
  generateFinalAssessment,
  generateTopicMaterials,
  repairInputSchema,
  repairTest,
  testInputSchema,
  topicInputSchema,
} from './steps/generate-materials.ts';
import { parseRequest } from './steps/parse-request.ts';
import { reviewCourse, reviewInputSchema } from './steps/review-course.ts';
import { usageSummary } from './usage.ts';

const root = resolve(import.meta.dirname, '..');
const staticDir = resolve(process.env.STATIC_DIR ?? join(root, '../frontend/dist'));
const gateway = new LlmGateway({
  baseUrl: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
  dataDir: resolve(process.env.DATA_DIR ?? join(root, 'var')),
});

const agent = new AgentRunner(
  gateway,
  resolve(process.env.DATA_DIR ?? join(root, 'var')),
  process.env.AGENT_BUNDLE ?? join(root, '../frontend/dist-agent/headless.js'),
);

const statusByCode: Record<LlmErrorCode, number> = {
  unavailable: 503,
  rate_limited: 429,
  timeout: 504,
  upstream: 502,
  rejected: 502,
  empty: 502,
};

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const parseRequestBody = z.object({ request: z.string().trim().min(1).max(8000) });

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new HttpError(413, 'Запрос слишком большой.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Тело запроса должно быть JSON.');
  }
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Единый эндпоинт агента для автопроверки и внешних систем; описание — в README.
async function handleAgent(request: IncomingMessage, response: ServerResponse, path: string) {
  if (request.method === 'GET' && path === '/api/v1/agent')
    return sendJson(response, 200, {
      description:
        'POST /api/v1/agent {request, clarifications?, answers?, approve?, wait?} собирает программу и комплект материалов.',
      model_available: gateway.available,
    });
  if (request.method === 'POST' && path === '/api/v1/agent') {
    if (!gateway.available)
      throw new LlmError(
        'unavailable',
        'Модель не настроена: нет OPENAI_BASE_URL или OPENAI_API_KEY.',
      );
    const body = agentRequestSchema.safeParse(await readJson(request));
    if (!body.success)
      throw new HttpError(422, 'Нужен текст запроса методиста в поле request (до 8000 символов).');
    const run = await agent.start(body.data);
    return sendJson(response, body.data.wait ? 200 : 202, agent.view(run));
  }
  const match = path.match(/^\/api\/v1\/agent\/runs\/([^/]+)(?:\/(approve|files\/([^/]+)))?$/);
  if (!match) throw new HttpError(404, 'Такого метода API нет.');
  const [, id, action, fileName] = match;
  if (request.method === 'GET' && !action) {
    const run = await agent.get(id);
    if (!run) throw new HttpError(404, 'Сборка не найдена.');
    return sendJson(response, 200, agent.view(run));
  }
  if (request.method === 'POST' && action === 'approve') {
    const run = await agent.approve(id);
    if (!run) throw new HttpError(409, 'Сборка не ждёт утверждения.');
    return sendJson(response, run.request.wait ? 200 : 202, agent.view(run));
  }
  if (request.method === 'GET' && fileName) {
    const file = await agent.file(id, fileName);
    if (!file) throw new HttpError(404, 'Файл не найден.');
    response.writeHead(200, {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    return response.end(file.body);
  }
  throw new HttpError(404, 'Такого метода API нет.');
}

async function handleApi(request: IncomingMessage, response: ServerResponse, path: string) {
  if (path.startsWith('/api/v1/agent')) return handleAgent(request, response, path);
  if (request.method === 'GET' && path === '/api/llm/status')
    return sendJson(response, 200, {
      available: gateway.available,
      routes: Object.fromEntries(
        Object.entries(routes).map(([step, route]) => [step, route.model]),
      ),
    });
  if (request.method === 'GET' && path === '/api/llm/usage')
    return sendJson(response, 200, usageSummary(await gateway.readLog()));
  if (request.method === 'POST' && path === '/api/llm/parse-request') {
    const body = parseRequestBody.safeParse(await readJson(request));
    if (!body.success)
      throw new HttpError(422, 'Нужен текст запроса методиста длиной до 8000 символов.');
    return sendJson(response, 200, await parseRequest(gateway, body.data.request));
  }
  if (request.method === 'POST' && path === '/api/llm/clarify-questions') {
    const body = questionsInputSchema.safeParse(await readJson(request));
    if (!body.success) throw new HttpError(422, 'Нужен текст запроса методиста.');
    return sendJson(response, 200, await clarifyQuestions(gateway, body.data));
  }
  if (request.method === 'POST' && path === '/api/llm/draft-skeleton') {
    const body = skeletonInputSchema.safeParse(await readJson(request));
    if (!body.success)
      throw new HttpError(422, 'Нужны запрос методиста и подтверждённый объём от 16 до 500 часов.');
    return sendJson(response, 200, await draftSkeleton(gateway, body.data));
  }
  // Шаги после утверждения каркаса: браузер вызывает их по частям и сам собирает материалы.
  const contentSteps = {
    '/api/llm/topic-materials': [topicInputSchema, generateTopicMaterials],
    '/api/llm/course-test': [testInputSchema, generateCourseTest],
    '/api/llm/final-assessment': [finalInputSchema, generateFinalAssessment],
    '/api/llm/review-course': [reviewInputSchema, reviewCourse],
    '/api/llm/repair-test': [repairInputSchema, repairTest],
  } as const;
  if (request.method === 'POST' && path in contentSteps) {
    const [schema, step] = contentSteps[path as keyof typeof contentSteps];
    const body = schema.safeParse(await readJson(request));
    if (!body.success)
      throw new HttpError(422, `Неверные данные шага: ${body.error.issues[0]?.message ?? ''}`);
    return sendJson(
      response,
      200,
      await (step as (g: LlmGateway, i: unknown) => Promise<unknown>)(gateway, body.data),
    );
  }
  throw new HttpError(404, 'Такого метода API нет.');
}

async function serveStatic(response: ServerResponse, path: string) {
  // normalize убирает «..», а проверка префикса не даёт выйти за папку сборки.
  const filePath = join(staticDir, normalize(decodeURIComponent(path)));
  const isFile =
    filePath.startsWith(staticDir) &&
    (await stat(filePath).then(
      (s) => s.isFile(),
      () => false,
    ));
  // Маршруты React Router существуют только в браузере, поэтому отдаём index.html.
  const target = isFile ? filePath : join(staticDir, 'index.html');
  const body = await readFile(target).catch(() => null);
  if (!body) return sendJson(response, 404, { detail: 'Сборка фронтенда не найдена.' });
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(target)] ?? 'application/octet-stream',
    // Файлы из assets содержат хеш в имени, их можно кэшировать надолго.
    'Cache-Control': path.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  try {
    if (path.startsWith('/api/')) await handleApi(request, response, path);
    else await serveStatic(response, path);
  } catch (error) {
    if (error instanceof LlmError)
      return sendJson(response, statusByCode[error.code], {
        detail: error.message,
        code: error.code,
      });
    if (error instanceof HttpError)
      return sendJson(response, error.status, { detail: error.message });
    console.error(error);
    sendJson(response, 500, { detail: 'Внутренняя ошибка сервера.' });
  }
});

const port = Number(process.env.PORT ?? 8000);
const host = process.env.HOST ?? '0.0.0.0';
server.listen(port, host, () => {
  console.log(
    `CourseOS: http://${host}:${port}, фронтенд из ${staticDir}, модель ${gateway.available ? 'подключена' : 'не настроена'}`,
  );
});
