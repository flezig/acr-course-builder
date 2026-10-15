import { z } from 'zod';
import Decimal from 'decimal.js';
import { normalizeDecimal } from '../../../shared/lib/decimal';
const decimalPattern = /^\d+(?:[.,]\d+)?$/;
export const decimalSchema = z
  .string()
  .trim()
  .regex(decimalPattern, 'Введите неотрицательное число, например 16 или 16,5')
  .transform(normalizeDecimal);
const optionalDecimalSchema = z
  .string()
  .trim()
  .refine(
    (value) => !value || decimalPattern.test(value),
    'Введите неотрицательное число, например 16 или 16,5',
  )
  .transform((value) => (value ? normalizeDecimal(value) : ''));
// В образцах АЦР нет часов мельче 0,5: иначе учебный план нельзя разложить без дробных хвостов.
const hourStepMessage = 'Объём указывается с шагом 0,5 ч, например 72 или 16,5';
const onHourStep = (value: string) => new Decimal(value).mod('0.5').eq(0);
export const courseHoursSchema = decimalSchema
  .refine(
    (value) => new Decimal(value).gte(16) && new Decimal(value).lte(500),
    'Объём — от 16 до 500 часов',
  )
  .refine(onHourStep, hourStepMessage);
const optionalHoursSchema = optionalDecimalSchema
  .refine(
    (value) => !value || (new Decimal(value).gte(16) && new Decimal(value).lte(500)),
    'Объём — от 16 до 500 часов',
  )
  .refine((value) => !value || onHourStep(value), hourStepMessage);
export const requirementsSchema = z.object({
  request: z.string(),
  title: z.string(),
  template_id: z.enum(['acr_general', 'acr_professional', 'unknown']),
  audience: z.string(),
  entry_level: z.string(),
  goal: z.string(),
  total_hours: optionalDecimalSchema,
  delivery: z.string(),
  assessment: z.string(),
  constraints: z.string(),
  calendar: z.object({
    description: z.string(),
    start: z.string(),
    calendar_days: z
      .number({ error: 'Введите целое число дней' })
      .int('Введите целое число дней')
      .min(0, 'Число дней не может быть отрицательным')
      .max(3650, 'Укажите не больше 3650 дней'),
    weekdays_only: z.boolean(),
    daily_limit: optionalDecimalSchema,
    confirmed: z.boolean(),
    same_units: z.boolean(),
  }),
  references: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      text: z.string(),
      url: z.string(),
      status: z.enum(['provided', 'retrieved', 'human_verified', 'unconfirmed']),
      coordinate: z.string(),
      claim: z.string(),
      checked_at: z.string(),
      scope: z.string(),
      hash: z.string(),
      provenance: z
        .object({
          origin: z.enum(['user_text', 'url', 'file', 'research']),
          access: z.enum(['registered', 'available', 'read']),
          content: z.enum(['unverified', 'confirmed']),
          extent: z.enum(['none', 'excerpt', 'abstract', 'full_text']),
          authors: z.string(),
          year: z.string(),
          title: z.string(),
          doi: z.string(),
          study_type: z.string(),
          population: z.string(),
          result: z.string(),
        })
        .optional(),
    }),
  ),
});
export type Requirements = z.infer<typeof requirementsSchema>;
export const inputSchema = requirementsSchema.extend({
  title: z.string().trim().min(2, 'Укажите тему курса — не менее 2 символов'),
  audience: z.string().trim().min(1, 'Укажите, кто будет учиться'),
  total_hours: optionalHoursSchema,
  calendar: requirementsSchema.shape.calendar.extend({
    daily_limit: optionalDecimalSchema,
  }),
});
export const hoursSchema = z.object({
  lecture: decimalSchema,
  practice: decimalSchema,
  lab: decimalSchema,
  self_study: decimalSchema,
  assessment: decimalSchema,
});
export const outcomeSchema = z.object({
  id: z.string(),
  kind: z.enum(['knowledge', 'skill', 'proficiency']),
  description: z.string(),
  requirement_id: z.string(),
  prerequisite: z.string(),
  depth: z.string(),
  professional_standard_code: z.string().nullable(),
  title: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  edited_by: z.literal('human').optional(),
  review: z.object({ signature: z.string(), checked_at: z.string() }).optional(),
});
export const topicSchema = z.object({
  id: z.string(),
  module_id: z.string(),
  title: z.string(),
  content: z.string(),
  hours: hoursSchema,
  planned_total: decimalSchema,
  prerequisite_ids: z.array(z.string()),
  outcome_ids: z.array(z.string()),
  delivery: z.string(),
  control: z.string(),
});
const assessmentSchema = z.object({
  id: z.string(),
  topic_id: z.string(),
  outcome_ids: z.array(z.string()),
  type: z.enum(['test', 'practical', 'project', 'portfolio', 'exam', 'mentor_interview']),
  action: z.string(),
  criterion: z.string(),
});
const explanationSchema = z.object({
  id: z.string(),
  category: z.enum(['reachability', 'sequence', 'hours', 'assessment', 'conflicts']),
  title: z.string(),
  conclusion: z.string(),
  detail: z.string(),
  related_ids: z.array(z.string()),
  evidence: z.array(
    z.object({
      type: z.enum(['request', 'reference', 'calculation', 'assumption']),
      text: z.string(),
      source_id: z.string().nullable(),
    }),
  ),
  status: z.enum(['verified', 'needs_review', 'blocked']),
  missing: z.string(),
});
const conflictSchema = z.object({
  id: z.string(),
  requirement_ids: z.array(z.string()),
  status: z.enum(['open', 'resolved']),
  expected: z.string(),
  actual: z.string(),
  calculation: z.string(),
  options: z.array(z.object({ id: z.string(), title: z.string(), consequence: z.string() })),
  decision: z
    .object({
      option_id: z.string(),
      actor: z.string(),
      at: z.string(),
      before: z.string(),
      after: z.string(),
    })
    .nullable(),
});
export const rationaleSchema = z.object({
  id: z.string(),
  element_id: z.string(),
  version: z.number().int(),
  decision: z.string(),
  purpose: z.string(),
  related_ids: z.array(z.string()),
  kind: z.enum([
    'request',
    'subject_reference',
    'research',
    'calculation',
    'expert',
    'assumption',
    'gap',
  ]),
  source_id: z.string().nullable(),
  fragment: z.string(),
  coordinate: z.string(),
  applicability: z.string(),
  alternatives: z.string(),
  trust: z.string(),
  limitations: z.string(),
  status: z.enum([
    'unverified',
    'partial',
    'confirmed',
    'expert_checked',
    'pilot_checked',
    'stale',
  ]),
  verification: z.string(),
  next_check: z.string(),
  phase: z.enum(['design', 'retrospective_review']),
  input_signature: z.string(),
  reviewer: z.string(),
  checked_at: z.string(),
});
export type Rationale = z.infer<typeof rationaleSchema>;
export const timeBudgetSchema = z.object({
  topic_id: z.string(),
  explanation: decimalSchema,
  supported_practice: decimalSchema,
  independent: decimalSchema,
  feedback: decimalSchema,
  assessment: decimalSchema,
  basis: z.enum(['request', 'expert', 'pilot', 'assumption']),
  note: z.string(),
});
export const skeletonSchema = z.object({
  schema_version: z.literal('1.0'),
  normalization_version: z.literal('canonical-decimal-v1'),
  requirements: requirementsSchema,
  template_version: z.literal('acr-2026-v1'),
  goal: z.string(),
  tasks: z.array(z.string()),
  outcomes: z.array(outcomeSchema),
  topics: z.array(topicSchema),
  activities: z.array(
    z.object({
      id: z.string(),
      topic_id: z.string(),
      outcome_ids: z.array(z.string()),
      description: z.string(),
    }),
  ),
  assessments: z.array(assessmentSchema),
  explanations: z.array(explanationSchema),
  // Optional extensions preserve the canonical bytes/hash of legacy snapshots.
  rationales: z.array(rationaleSchema).optional(),
  rationale_sources: requirementsSchema.shape.references.optional(),
  time_budgets: z.array(timeBudgetSchema).optional(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        purpose: z.string(),
        version: z.string(),
        source: z.string(),
        checked_at: z.string(),
        status: z.enum(['confirmed', 'unconfirmed']),
      }),
    )
    .optional(),
  dependency_reasons: z
    .array(z.object({ from_id: z.string(), to_id: z.string(), action: z.string() }))
    .optional(),
  design_stages: z
    .array(
      z.object({ id: z.string(), input_signature: z.string(), output_ids: z.array(z.string()) }),
    )
    .optional(),
  conflicts: z.array(conflictSchema),
});
export type Skeleton = z.infer<typeof skeletonSchema>;
export type Topic = z.infer<typeof topicSchema>;
export const materialSchema = z.object({
  id: z.string(),
  module_id: z.string(),
  topic_id: z.string(),
  outcome_ids: z.array(z.string()),
  assessment_id: z.string().nullable(),
  type: z.enum([
    'working_program',
    'test',
    'seminar',
    'lecture',
    'project',
    'portfolio',
    'exam',
    'mentor_interview',
  ]),
  title: z.string(),
  content: z.string(),
  expected: z.string(),
  criteria: z.array(z.string()),
  questions: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      options: z.array(z.string()),
      correct_index: z.number().int(),
      explanation: z.string(),
      outcome_ids: z.array(z.string()),
    }),
  ),
  slides: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      bullets: z.array(z.string()),
      notes: z.string(),
    }),
  ),
  source_ids: z.array(z.string()),
  manual: z.boolean(),
  stale: z.boolean(),
  hash: z.string(),
});
export type Material = z.infer<typeof materialSchema>;
export const issueSchema = z.object({
  id: z.string(),
  severity: z.enum(['error', 'warning', 'info']),
  check_type: z.enum(['rule', 'llm', 'human']),
  element_id: z.string(),
  message: z.string(),
  expected: z.string(),
  actual: z.string(),
  suggested_fix: z.string(),
  blocking: z.boolean(),
  // Поля очереди решений: доказательство с цифрами и местом, действие агента
  // и признак того, что методист может оставить находку как есть с указанием причины.
  evidence: z.string().optional(),
  fix: z.enum(['add_assessment', 'confirm_calendar']).optional(),
  dismissible: z.boolean().optional(),
  decision: z.object({ reason: z.string(), actor: z.string(), at: z.string() }).optional(),
});
export const auditSchema = z.object({
  course_version: z.number(),
  at: z.string(),
  checks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(['passed', 'failed', 'not_run']),
      expected: z.string(),
      actual: z.string(),
    }),
  ),
  issues: z.array(issueSchema),
  technical_ready: z.boolean(),
  expert_status: z.literal('not_reviewed'),
});
export type Audit = z.infer<typeof auditSchema>;
export const approvalSchema = z.object({
  course_id: z.string(),
  skeleton_version: z.number(),
  skeleton_hash: z.string(),
  actor_id: z.string(),
  approved_at: z.string(),
});
export const snapshotSchema = z.object({
  schema_version: z.literal('1.0'),
  course_id: z.string(),
  course_version: z.number().int(),
  mode: z.enum(['demo', 'live']),
  provenance: z.enum(['demo', 'live_action', 'previous_live']),
  created_at: z.string(),
  run_id: z.string(),
  draft: z.literal(true),
  skeleton_version: z.number().int(),
  skeleton_hash: z.string(),
  skeleton: skeletonSchema,
  materials: z.array(materialSchema),
  sections: z.array(z.object({ id: z.string(), title: z.string(), content: z.string() })),
  sources: requirementsSchema.shape.references,
  edges: z.array(
    z.object({ from_id: z.string(), to_id: z.string(), relation: z.string(), reason: z.string() }),
  ),
  material_links: z.array(z.object({ assessment_id: z.string(), material_id: z.string() })),
  audit: auditSchema,
  observations: z.array(issueSchema).default([]),
  decisions: z
    .array(
      z.object({ issue_id: z.string(), reason: z.string(), actor: z.string(), at: z.string() }),
    )
    .default([]),
  approvals: z.array(approvalSchema),
  approval_applicable: z.boolean(),
  approval_at_creation: z.boolean().optional(),
  changes: z.array(
    z.object({
      id: z.string(),
      base_version: z.number(),
      result_version: z.number(),
      request: z.string(),
      affected_ids: z.array(z.string()),
      preserved: z.array(
        z.object({
          id: z.string(),
          before_hash: z.string(),
          after_hash: z.string(),
          equal: z.boolean(),
        }),
      ),
    }),
  ),
  export_manifest: z.array(
    z.object({
      format: z.enum(['json', 'docx', 'pptx', 'lms']),
      status: z.enum(['ready', 'unavailable', 'creating', 'failed']),
      course_version: z.number(),
      file_id: z.string().nullable(),
      filename: z.string(),
      reason: z.string(),
      hash: z.string().nullable(),
    }),
  ),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const jobStatusSchema = z.enum([
  'queued',
  'running',
  'awaiting_clarification',
  'awaiting_approval',
  'needs_review',
  'succeeded',
  'failed',
  'cancelled',
]);
export const jobSchema = z.object({
  id: z.string(),
  course_id: z.string(),
  request_id: z.string(),
  operation: z.string(),
  status: jobStatusSchema,
  started_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
  steps: z.array(z.string()),
  next_action: z.string(),
  error: z.string().nullable(),
  usage: z.object({
    tokens: z.number().nullable(),
    cost: z.string().nullable(),
    source: z.string(),
  }),
  attempt: z.number(),
  partial_materials: z.array(materialSchema).default([]),
});
export type Job = z.infer<typeof jobSchema>;
export const courseViewSchema = z.object({
  snapshot: snapshotSchema.nullable(),
  requirements: requirementsSchema,
  course_id: z.string(),
  latest_version: z.number(),
  versions: z.array(z.number()),
  questions: z.array(z.object({ field: z.string(), label: z.string() })),
  job: jobSchema,
  is_latest: z.boolean(),
});
export type CourseView = z.infer<typeof courseViewSchema>;
export const changeInputSchema = z
  .object({
    type: z.enum(['question', 'project', 'topic', 'hours', 'audience']),
    target_id: z.string(),
    request: z.string().trim().min(3, 'Опишите причину изменения — не менее 3 символов'),
    replacement: z.string().trim().min(2, 'Введите новый текст — не менее 2 символов'),
    correct_index: z.number().int().optional(),
    explanation: z.string().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.type !== 'hours') return;
    const result = courseHoursSchema.safeParse(input.replacement);
    if (!result.success)
      ctx.addIssue({
        code: 'custom',
        path: ['replacement'],
        message: result.error.issues[0].message,
      });
  });
export type ChangeInput = z.infer<typeof changeInputSchema>;
export const changePlanSchema = z.object({
  id: z.string(),
  course_id: z.string(),
  base_version: z.number(),
  input: changeInputSchema,
  requires_approval: z.boolean(),
  affected: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      reason: z.string(),
      before: z.string(),
      after: z.string(),
      manual: z.boolean(),
    }),
  ),
  preserved_ids: z.array(z.string()),
  cost: z.string().nullable(),
});
export type ChangePlan = z.infer<typeof changePlanSchema>;
export const courseSummarySchema = z.object({
  course_id: z.string(),
  title: z.string(),
  total_hours: z.string(),
  latest_version: z.number(),
  status: jobStatusSchema,
  template_id: z.string(),
});
export type CourseSummary = z.infer<typeof courseSummarySchema>;
