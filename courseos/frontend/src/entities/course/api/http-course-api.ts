import { skeletonRationaleMarkdown } from '../model/rationale';
import { z } from 'zod';
import {
  courseSummarySchema,
  courseViewSchema,
  jobSchema,
  changePlanSchema,
  requirementsSchema,
} from '../model/schema';
import { HttpTransport, ApiError } from '../../../shared/api/http';
import type { CommandEnvelope, CourseApi } from './contract';
const resultSchema = z.object({
  course_id: z.string(),
  job: jobSchema,
  change_plan: changePlanSchema.nullable(),
});
export class HttpCourseApi implements CourseApi {
  readonly mode = 'live';
  private transport: HttpTransport;
  constructor(baseUrl: string) {
    this.transport = new HttpTransport(baseUrl);
  }
  list() {
    return this.transport.request('/courses', z.array(courseSummarySchema));
  }
  get(id: string, version?: number) {
    return this.transport.request(
      `/courses/${encodeURIComponent(id)}${version ? `?version=${version}` : ''}`,
      courseViewSchema,
    );
  }
  command(envelope: CommandEnvelope) {
    if (envelope.action === 'save_skeleton')
      return this.transport.request(
        `/courses/${encodeURIComponent(envelope.course_id!)}/skeleton`,
        resultSchema,
        { method: 'PATCH', body: JSON.stringify(envelope) },
      );
    if (envelope.action === 'manual_material')
      return this.transport.request(
        `/courses/${encodeURIComponent(envelope.course_id!)}/materials/${encodeURIComponent(envelope.payload.material_id)}`,
        resultSchema,
        { method: 'PATCH', body: JSON.stringify(envelope) },
      );
    if (envelope.action === 'resolve_calendar')
      return this.transport.request(
        `/courses/${encodeURIComponent(envelope.course_id!)}/conflicts/calendar/resolve`,
        resultSchema,
        { method: 'POST', body: JSON.stringify(envelope) },
      );
    if (envelope.action === 'record_observation' || envelope.action === 'resolve_observation')
      return this.transport.request(
        `/courses/${encodeURIComponent(envelope.course_id!)}/observations`,
        resultSchema,
        { method: 'POST', body: JSON.stringify(envelope) },
      );
    return this.transport.request('/agent', resultSchema, {
      method: 'POST',
      body: JSON.stringify(envelope),
    });
  }
  getJob(id: string) {
    return this.transport.request(`/jobs/${encodeURIComponent(id)}`, jobSchema);
  }
  getChange(id: string, changeId: string) {
    return this.transport.request(
      `/courses/${encodeURIComponent(id)}/changes/${encodeURIComponent(changeId)}`,
      changePlanSchema,
    );
  }
  exportJson(id: string, version: number) {
    return this.transport.file(
      `/courses/${encodeURIComponent(id)}/exports/json?version=${version}`,
    );
  }
  async exportMarkdown(id: string, version: number): Promise<Blob> {
    const view = await this.get(id, version);
    if (
      !view.snapshot ||
      view.snapshot.course_id !== id ||
      view.snapshot.course_version !== version
    )
      throw new ApiError(409, 'Сервер не вернул выбранную сохранённую версию.');
    return new Blob([skeletonRationaleMarkdown(view.snapshot)], {
      type: 'text/markdown;charset=utf-8',
    });
  }
  downloadFile(id: string) {
    return this.transport.file(`/files/${encodeURIComponent(id)}`);
  }
  retrieveReference(id: string, url: string) {
    return this.transport.request(
      `/courses/${encodeURIComponent(id)}/references`,
      requirementsSchema.shape.references.element,
      { method: 'POST', body: JSON.stringify({ kind: 'url', url }) },
    );
  }
  uploadReference(id: string, file: File) {
    const body = new FormData();
    body.append('file', file);
    return this.transport.request(
      `/courses/${encodeURIComponent(id)}/references`,
      requirementsSchema.shape.references.element,
      { method: 'POST', body },
    );
  }
  async reset(): Promise<void> {
    throw new ApiError(403, 'Сброс доступен только в демонстрационном режиме.');
  }
}
