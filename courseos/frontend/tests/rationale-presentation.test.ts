import { describe, expect, it } from 'vitest';
import { makeSkeleton } from '../src/entities/course/model/factory';
import { presets } from '../src/entities/course/model/presets';
import {
  currentRationales,
  rationaleSignature,
  skeletonElements,
} from '../src/entities/course/model/rationale';
import {
  elementDecision,
  elementName,
  rationaleGroup,
  rationaleSummary,
} from '../src/pages/course-plan/rationale-presentation';

const example = () => makeSkeleton(structuredClone(presets[0].requirements));
describe('Понятное представление оснований', () => {
  it('показывает часы и календарь без служебного JSON и сохраняет исходную версию', () => {
    const s = example();
    const before = JSON.stringify(s);
    for (const element of skeletonElements(s)) {
      const decision = elementDecision(s, element);
      expect(decision).not.toMatch(
        /time_budgets|"calendar_days"|"supported_practice"|lecture=|self_study=/,
      );
      expect(elementName(s, element)).not.toMatch(/topic-\d|outcome-\d|assessment-|activity-/);
    }
    expect(JSON.stringify(s)).toBe(before);
  });
  it('после изменения аудитории требует повторной проверки даже для прежних условий запроса', () => {
    const s = example();
    const goal = skeletonElements(s).find((e) => e.id === 'goal')!;
    let signature = rationaleSignature(s);
    expect(
      rationaleSummary(s, goal, currentRationales(s, goal.id, signature), signature).needsReview,
    ).toBe(false);
    s.requirements.audience = 'Взрослые слушатели';
    signature = rationaleSignature(s);
    const summary = rationaleSummary(s, goal, currentRationales(s, goal.id, signature), signature);
    expect(summary.label).toBe('Проверить заново');
    expect(summary.needsReview).toBe(true);
    expect(summary.next).toContain('Условия курса изменились');
  });
  it('частичная исследовательская опора и отсутствие пояснения не считаются подтверждением', () => {
    const s = example();
    const activity = skeletonElements(s).find((e) => e.id === 'activity-topic-4')!;
    const signature = rationaleSignature(s);
    const summary = rationaleSummary(
      s,
      activity,
      currentRationales(s, activity.id, signature),
      signature,
    );
    expect(summary.label).toBe('Подтверждено частично');
    expect(summary.needsReview).toBe(true);
    expect(summary.why).toContain('ещё нужно проверить');
    expect(rationaleSummary(s, activity, [], signature).label).toBe('Нет пояснения');
  });
  it('относит критерии к проверке знаний, а часы темы — к расписанию', () => {
    const s = example();
    expect(rationaleGroup(s, `criterion:${s.assessments[0].id}`)).toBe('assessment');
    expect(rationaleGroup(s, `hours:${s.topics[0].id}`)).toBe('time');
  });
});
