import { proposedAssessment, proposedCalendar, outcomeNumber } from './findings';
import { assessmentLabels } from './presets';
import { calendarCalculation } from './rules';
import type { Snapshot } from './schema';

type Issue = Snapshot['audit']['issues'][number];

// Что произойдёт с программой, если методист примет предложение агента. Считается теми же
// функциями, что и само применение (proposedAssessment, proposedCalendar), поэтому
// описание не расходится с результатом.
export function fixConsequences(snapshot: Snapshot, issue: Issue): string[] {
  const skeleton = snapshot.skeleton;
  const changes: string[] = [];
  if (issue.fix === 'add_assessment') {
    const assessment = proposedAssessment(skeleton, issue.element_id);
    if (!assessment) return [];
    const topic = skeleton.topics.find((t) => t.id === assessment.topic_id);
    changes.push(
      `В теме «${topic?.title}» появится ${assessmentLabels[assessment.type].toLowerCase()}: ${assessment.action.toLowerCase()}.`,
      `Результат ${outcomeNumber(skeleton, issue.element_id)} будут проверять два разных оценочных средства, и это замечание закроется.`,
      'Часы, темы и результаты не изменятся.',
    );
  } else if (issue.fix === 'confirm_calendar') {
    const calendar = proposedCalendar(skeleton.requirements);
    if (!calendar) return [];
    changes.push(
      `Календарь будет подтверждён: ${calendar.description.replace(/\.?\s*Подтверждено методистом\.$/, '')}.`,
      'Часы, темы и результаты не изменятся.',
    );
    const deficit = calendarCalculation({ ...skeleton.requirements, calendar }).deficit;
    if (deficit && Number(deficit) > 0)
      changes.push(
        `Нехватка ${deficit} ч останется: следующим решением нужно будет продлить срок, сократить объём или поднять дневной лимит.`,
      );
  } else return [];
  changes.push(`Появится версия ${snapshot.course_version + 1}; текущая останется в истории.`);
  // Утверждение привязано к hash каркаса; блокирующие замечания здесь не важны —
  // важно, что после правки утверждённый каркас перестанет совпадать.
  if (
    snapshot.approvals.some(
      (a) =>
        a.skeleton_version === snapshot.skeleton_version &&
        a.skeleton_hash === snapshot.skeleton_hash,
    )
  )
    changes.push('Каркас изменится, поэтому программу нужно будет утвердить заново.');
  if (snapshot.materials.length)
    changes.push('Материалы этой версии будут помечены устаревшими: их нужно пересобрать.');
  return changes;
}
