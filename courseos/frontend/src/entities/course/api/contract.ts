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
import type {
  AiEditOutcome,
  AiEditOutcomeInput,
  FeedbackInput,
  FeedbackPatch,
  ResponseFeedback,
} from '../model/feedback';
import { exportFileName } from '../export/file-names';
export type CourseCommand =
  | { action: 'start'; payload: Requirements }
  | { action: 'clarify'; payload: Requirements }
  | { action: 'save_skeleton'; payload: Skeleton }
  | {
      action: 'approve';
      payload: {
        skeleton_version: number;
        skeleton_hash: string;
        actor_id?: string;
        kind?: 'human' | 'automatic';
      };
    }
  | { action: 'change_preview'; payload: ChangeInput }
  | { action: 'change_apply'; payload: { change_id: string; overwrite_manual: boolean } }
  | {
      action: 'record_observation';
      payload: { message: string; element_id: string; blocking: boolean };
    }
  | { action: 'resolve_observation'; payload: { issue_id: string; correction: string } }
  | { action: 'prune_history'; payload: { keep_versions: number[]; archive_saved: boolean } }
  | { action: 'audit'; payload: Record<string, never> }
  | { action: 'retry' | 'cancel'; payload: { job_id: string } }
  | { action: 'manual_material'; payload: { material_id: string; content: string } }
  | { action: 'apply_finding'; payload: { issue_id: string } }
  | { action: 'dismiss_finding'; payload: { issue_id: string; reason: string; actor?: string } }
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
/** Часть программы, которую видит методист на открытой вкладке. */
export type EditScope = 'intent' | 'curriculum' | 'calendar' | 'outcomes' | 'materials';
/**
 * Свободный запрос методиста к ИИ. ИИ получает весь каркас, но меняет
 * только часть, относящуюся к открытой вкладке, и возвращает каркас целиком.
 */
export interface ScopeEditRequest {
  course_id: string;
  course_version: number;
  scope: EditScope;
  request: string;
  skeleton: Skeleton;
}
export interface ScopeEditProposal {
  skeleton: Skeleton;
  note: string;
}
export interface CourseApi {
  readonly mode: 'demo' | 'live';
  list(): Promise<CourseSummary[]>;
  get(courseId: string, version?: number): Promise<CourseView>;
  delete(courseId: string): Promise<void>;
  command(envelope: CommandEnvelope): Promise<CommandResult>;
  getJob(jobId: string): Promise<Job>;
  getChange(courseId: string, changeId: string): Promise<ChangePlan>;
  exportJson(courseId: string, version: number): Promise<Blob>;
  exportMarkdown(courseId: string, version: number): Promise<Blob>;
  downloadFile(fileId: string): Promise<Blob>;
  retrieveReference(courseId: string, url: string): Promise<Requirements['references'][number]>;
  uploadReference(courseId: string, file: File): Promise<Requirements['references'][number]>;
  reset(): Promise<void>;
  proposeScopeEdit(input: ScopeEditRequest): Promise<ScopeEditProposal>;
  // Отзывы хранятся отдельно от версий программы: они не меняют hash каркаса
  // и остаются после удаления курса, чтобы по ним можно было разбирать ошибки генерации.
  recordFeedback(input: FeedbackInput): Promise<ResponseFeedback>;
  listFeedback(): Promise<ResponseFeedback[]>;
  updateFeedback(id: string, patch: FeedbackPatch): Promise<ResponseFeedback>;
  recordAiEditOutcome(input: AiEditOutcomeInput): Promise<AiEditOutcome>;
  listAiEditOutcomes(): Promise<AiEditOutcome[]>;
}
// В демо файлы собираются в браузере из снимка версии, поэтому файл
// есть всегда, когда в версии есть что выгружать.
export function withManifest(snapshot: Snapshot): Snapshot {
  const hasLectures = snapshot.materials.some((m) => m.type === 'lecture' && m.slides.length);
  const hasQuestions = snapshot.materials.some((m) => m.type === 'test' && m.questions.length);
  const hasMaterials = snapshot.materials.length > 0;
  const notGenerated = 'Файл появится после утверждения плана и создания материалов.';
  const reasons = {
    json: 'В начале файла — сводка программы (результаты с кодами РО, учебный план по модулям, расписание, список материалов) и перечень того, что проверить. Дальше — полная сохранённая версия курса со всеми материалами и результатами проверок.',
    docx: hasMaterials
      ? 'Титульный лист, пояснительная записка, учебный план, рабочие программы тем и оценочные материалы с ключами. Реквизиты приказа, ФИО и подписи оставлены пустыми; в конце — лист проверки методистом, его удаляют перед утверждением.'
      : notGenerated,
    pptx: !hasMaterials
      ? notGenerated
      : hasLectures
        ? 'Обложка, список тем, титульный слайд каждой темы с результатами обучения и слайды лекций. Пояснения для преподавателя — в заметках докладчика.'
        : 'В этой версии нет лекций со слайдами.',
    lms: !hasMaterials
      ? notGenerated
      : hasQuestions
        ? 'Импорт: Курс → Банк вопросов → Импорт → «Moodle XML». Каждый тест — отдельная категория, у вопросов есть ключ, пояснение и тег с кодом результата обучения.'
        : 'В этой версии нет тестов с вопросами.',
  };
  snapshot.export_manifest = (['json', 'docx', 'pptx', 'lms'] as const).map((format) => {
    const ready =
      format === 'json' ||
      (hasMaterials &&
        (format === 'docx' ||
          (format === 'pptx' && hasLectures) ||
          (format === 'lms' && hasQuestions)));
    return {
      format,
      status: ready ? 'ready' : 'unavailable',
      course_version: snapshot.course_version,
      file_id: ready ? `${format}:${snapshot.course_id}:${snapshot.course_version}` : null,
      filename: exportFileName(snapshot, format),
      reason: reasons[format],
      hash: null,
    };
  });
  return snapshot;
}
