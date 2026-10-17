import type { Snapshot } from '../model/schema';
import { sectionCompleteness } from '../model/sections';
import { unconfirmedSources } from './curriculum';

export type ReviewItem = { title: string; detail: string };

export function approvedAtCreation(snapshot: Snapshot) {
  return (
    snapshot.approval_at_creation ??
    snapshot.approvals.some(
      (a) =>
        a.skeleton_hash === snapshot.skeleton_hash &&
        a.skeleton_version === snapshot.skeleton_version &&
        a.approved_at <= snapshot.created_at,
    )
  );
}

// Что методисту нужно сделать или проверить до утверждения программы.
// Список строится из сохранённой версии, поэтому одинаков во всех выгрузках.
export function reviewItems(snapshot: Snapshot): ReviewItem[] {
  const items: ReviewItem[] = [];
  if (!approvedAtCreation(snapshot))
    items.push({
      title: 'Утвердить план программы',
      detail: 'Цели, темы и часы этой версии ещё не утверждены методистом.',
    });
  // Открытые противоречия календаря аудит уже переводит в замечания,
  // поэтому отдельно они не перечисляются.
  for (const issue of snapshot.audit.issues.filter(
    (i) =>
      !i.decision && i.severity !== 'info' && !snapshot.decisions.some((d) => d.issue_id === i.id),
  ))
    items.push({
      title: issue.blocking ? `Исправить: ${issue.message}` : `Проверить: ${issue.message}`,
      detail: issue.suggested_fix,
    });
  for (const section of sectionCompleteness(snapshot).filter((s) => !s.complete && s.section))
    items.push({
      title: `Заполнить раздел «${section.title}»`,
      detail: `Не хватает: ${section.missing.map((m) => m[0].toLowerCase() + m.slice(1)).join('; ')}.`,
    });
  const sources = unconfirmedSources(snapshot);
  if (sources.length)
    items.push({
      title: 'Проверить источники',
      detail: `Не подтверждены: ${sources.map((s) => s.name).join('; ')}.`,
    });
  if (snapshot.materials.some((m) => m.type === 'test' && m.questions.length))
    items.push({
      title: 'Проверить ключи тестов',
      detail: 'Верные ответы и пояснения подготовлены агентом и требуют сверки преподавателем.',
    });
  return items;
}
