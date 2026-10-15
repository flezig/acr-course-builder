import type {
  ChangeInput,
  ChangePlan,
  CourseSummary,
  CourseView,
  Job,
  Requirements,
  Skeleton,
  Snapshot,
} from '../model/schema';
export type CourseCommand =
  | { action: 'start'; payload: Requirements }
  | { action: 'clarify'; payload: Requirements }
  | { action: 'save_skeleton'; payload: Skeleton }
  | { action: 'approve'; payload: { skeleton_version: number; skeleton_hash: string } }
  | { action: 'change_preview'; payload: ChangeInput }
  | { action: 'change_apply'; payload: { change_id: string; overwrite_manual: boolean } }
  | {
      action: 'record_observation';
      payload: { message: string; element_id: string; blocking: boolean };
    }
  | { action: 'resolve_observation'; payload: { issue_id: string; correction: string } }
  | { action: 'audit'; payload: Record<string, never> }
  | { action: 'retry' | 'cancel'; payload: { job_id: string } }
  | { action: 'manual_material'; payload: { material_id: string; content: string } }
  | {
      action: 'resolve_calendar';
      payload: {
        option: 'confirm' | 'extend' | 'reduce' | 'raise';
        calendar: Requirements['calendar'];
      };
    };
export type CommandEnvelope = CourseCommand & {
  request_id: string;
  course_id?: string;
  expected_version?: number;
};
export interface CommandResult {
  course_id: string;
  job: Job;
  change_plan: ChangePlan | null;
}
export interface CourseApi {
  readonly mode: 'demo' | 'live';
  list(): Promise<CourseSummary[]>;
  get(courseId: string, version?: number): Promise<CourseView>;
  command(envelope: CommandEnvelope): Promise<CommandResult>;
  getJob(jobId: string): Promise<Job>;
  getChange(courseId: string, changeId: string): Promise<ChangePlan>;
  exportJson(courseId: string, version: number): Promise<Blob>;
  exportMarkdown(courseId: string, version: number): Promise<Blob>;
  downloadFile(fileId: string): Promise<Blob>;
  retrieveReference(courseId: string, url: string): Promise<Requirements['references'][number]>;
  uploadReference(courseId: string, file: File): Promise<Requirements['references'][number]>;
  reset(): Promise<void>;
}
export function withManifest(snapshot: Snapshot): Snapshot {
  snapshot.export_manifest = (['json', 'docx', 'pptx', 'lms'] as const).map((format) => ({
    format,
    status: format === 'json' ? 'ready' : 'unavailable',
    course_version: snapshot.course_version,
    file_id: format === 'json' ? `json-${snapshot.course_id}-v${snapshot.course_version}` : null,
    filename: `${snapshot.course_id}-v${snapshot.course_version}.${format}`,
    reason:
      format === 'json'
        ? 'Полный демонстрационный snapshot; черновик для проверки'
        : format === 'lms'
          ? 'Целевая LMS и согласованный формат неизвестны; нужен экспортёр и пробный импорт.'
          : 'Серверный экспортёр не подключён. Существующий файл этой версии отсутствует.',
    hash: null,
  }));
  return snapshot;
}
