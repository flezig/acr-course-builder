import type { z } from 'zod';
import { ApiError } from '../../../shared/api/http';
import type { ContentSteps } from '../model/content-generation';
import {
  courseTestResultSchema,
  finalAssessmentResultSchema,
  programSectionsResultSchema,
  repairTestResultSchema,
  reviewResultSchema,
  topicMaterialsResultSchema,
} from '../model/generated-materials';

async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Сервер ждёт модель до 2 минут и повторяет запрос после сбоя.
      signal: AbortSignal.timeout(300_000),
    });
  } catch {
    throw new ApiError(0, 'Сервер CourseOS недоступен или модель не ответила вовремя.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      (payload as { detail?: string } | null)?.detail ?? 'Модель не справилась с шагом.',
    );
  return schema.parse(payload);
}

export const httpContentSteps: ContentSteps = {
  topic: (input) => post('/api/llm/topic-materials', input, topicMaterialsResultSchema),
  test: (input) => post('/api/llm/course-test', input, courseTestResultSchema),
  final: (input) => post('/api/llm/final-assessment', input, finalAssessmentResultSchema),
  review: (input) => post('/api/llm/review-course', input, reviewResultSchema),
  sections: (input) => post('/api/llm/program-sections', input, programSectionsResultSchema),
  repairTest: (input) => post('/api/llm/repair-test', input, repairTestResultSchema),
};
