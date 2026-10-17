import type { Snapshot } from '../model/schema';
import { assessmentLabels, kindLabels, materialLabels } from '../model/presets';
import { curriculumRows, programTypeName, unconfirmedSources } from './curriculum';
import { outcomeCodes } from './outcome-codes';
import { approvedAtCreation, reviewItems } from './review-items';

// Сводка program повторяет данные skeleton в том виде, в каком их видит
// методист: коды РО вместо внутренних id, модули с номерами тем, часы
// по видам работы. Полная версия курса идёт следом без изменений, чтобы
// выгрузку можно было сверить с хешем и загрузить обратно.
export function courseJson(snapshot: Snapshot, exportedAt: string) {
  const s = snapshot.skeleton;
  const req = s.requirements;
  const codes = outcomeCodes(s);
  const codesOf = (ids: string[]) => ids.map((id) => codes[id] ?? id);
  const rows = curriculumRows(s);
  const topicRow = (row: (typeof rows)[number]) => ({
    number: row.number,
    id: row.topic!.id,
    title: row.title,
    content: row.topic!.content,
    total_hours: row.total,
    hours: row.hours,
    control: row.control,
    outcomes: codesOf(row.topic!.outcome_ids),
  });
  const modules = rows
    .filter((row) => row.level === 'module')
    .map((module) => ({
      number: module.number,
      title: module.title,
      total_hours: module.total,
      hours: module.hours,
      topics: rows
        .filter((row) => row.level === 'topic' && row.number.startsWith(`${module.number}.`))
        .map(topicRow),
    }));
  const totals = rows.at(-1)!;
  const generation = snapshot.generation;
  return {
    format: 'courseos.course',
    format_version: '2.0',
    about:
      'Выгрузка одной версии курса. program — сводка программы для чтения и загрузки в другие системы; review — что проверить методисту перед утверждением; generation_cost — расход модели. Остальные поля — полная сохранённая версия: skeleton (структура и обоснования решений), materials, sections (разделы шаблона АЦР), audit (результаты проверок).',
    exported_at: exportedAt,
    status: {
      draft: true,
      approved: approvedAtCreation(snapshot),
      note: 'Черновик — требует проверки методистом.',
    },
    program: {
      title: req.title,
      program_type: programTypeName(req),
      total_hours: req.total_hours,
      delivery: req.delivery,
      audience: req.audience,
      entry_level: req.entry_level,
      goal: s.goal,
      tasks: s.tasks,
      final_assessment: req.assessment,
      calendar: req.calendar,
      outcomes: s.outcomes.map((o) => ({
        code: codes[o.id],
        id: o.id,
        kind: o.kind,
        kind_label: kindLabels[o.kind],
        text: o.description,
        professional_standard_code: o.professional_standard_code,
        assessed_by: s.assessments
          .filter((a) => a.outcome_ids.includes(o.id))
          .map((a) => ({
            type: a.type,
            type_label: assessmentLabels[a.type],
            action: a.action,
            criterion: a.criterion,
          })),
      })),
      curriculum: {
        total_hours: totals.total,
        hours: totals.hours,
        modules,
        // Итоговая аттестация не входит в модули, как в учебном плане АЦР.
        final_attestation: rows.filter((row) => row.level === 'topic' && !row.number).map(topicRow),
      },
      schedule: (s.sessions ?? []).map((session) => ({
        date: session.date,
        topic: s.topics.find((t) => t.id === session.topic_id)?.title ?? '',
        hours: session.hours,
      })),
      materials: snapshot.materials.map((m) => ({
        id: m.id,
        type: m.type,
        type_label: materialLabels[m.type],
        title: m.title,
        topic: s.topics.find((t) => t.id === m.topic_id)?.title ?? '',
        outcomes: codesOf(m.outcome_ids),
        questions: m.questions.length,
        slides: m.slides.length,
      })),
      unconfirmed_sources: unconfirmedSources(snapshot).map((source) => source.name),
    },
    review: reviewItems(snapshot),
    generation_cost: generation
      ? {
          calls: generation.calls.length,
          prompt_tokens: generation.calls.reduce((sum, c) => sum + c.prompt_tokens, 0),
          completion_tokens: generation.calls.reduce((sum, c) => sum + c.completion_tokens, 0),
          cost_rub: Number(generation.calls.reduce((sum, c) => sum + c.cost_rub, 0).toFixed(2)),
        }
      : null,
    ...snapshot,
    known_issues: snapshot.audit.issues,
  };
}
