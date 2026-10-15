import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DemoCourseApi } from '../src/entities/course/api/demo-course-api';
import { presets } from '../src/entities/course/model/presets';
import { makeSkeleton, refreshExplanations } from '../src/entities/course/model/factory';
import { hourTotals, auditSnapshot, calendarCalculation } from '../src/entities/course/model/rules';
import { canonicalJson, contentHash, sumHours, formatHours } from '../src/shared/lib/decimal';
import {
  inputSchema,
  snapshotSchema,
  type Skeleton,
  type Snapshot,
} from '../src/entities/course/model/schema';
import { HttpCourseApi } from '../src/entities/course/api/http-course-api';
import { generalRequirements, requestChecklist } from '../src/entities/course/model/checklist';
import { buildCoverage } from '../src/pages/competencies/coverage-model';
import { buildMap } from '../src/pages/competencies/map-model';
class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
let api: DemoCourseApi;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T14:00:00Z'));
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('navigator', {});
  api = new DemoCourseApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const preset = (id: string) => structuredClone(presets.find((p) => p.id === id)!.requirements);
async function startPython() {
  const result = await api.command({
    action: 'start',
    payload: preset('python'),
    request_id: crypto.randomUUID(),
  });
  vi.advanceTimersByTime(500);
  return (await api.get(result.course_id)).snapshot!;
}
async function approve(snapshot: Snapshot) {
  return api.command({
    action: 'approve',
    course_id: snapshot.course_id,
    expected_version: snapshot.course_version,
    request_id: crypto.randomUUID(),
    payload: { skeleton_version: snapshot.skeleton_version, skeleton_hash: snapshot.skeleton_hash },
  });
}
async function fullPython() {
  const snapshot = await startPython();
  await approve(snapshot);
  vi.advanceTimersByTime(2500);
  return (await api.get(snapshot.course_id)).snapshot!;
}
// Решения методиста перед утверждением: предложения агента применяются, остальные
// находки остаются как есть с причиной. Возвращает снимок после всех решений.
async function settleDecisions(courseId: string) {
  for (;;) {
    const snapshot = (await api.get(courseId)).snapshot!;
    const issue = snapshot.audit.issues.find((i) => i.blocking && (i.fix || i.dismissible));
    if (!issue) return snapshot;
    const envelope = {
      course_id: courseId,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
    };
    await api.command(
      issue.fix
        ? { ...envelope, action: 'apply_finding', payload: { issue_id: issue.id } }
        : {
            ...envelope,
            action: 'dismiss_finding',
            payload: { issue_id: issue.id, reason: 'Проверено методистом вручную' },
          },
    );
  }
}
async function saveSkeleton(snapshot: Snapshot, skeleton: Skeleton) {
  await api.command({
    action: 'save_skeleton',
    course_id: snapshot.course_id,
    expected_version: snapshot.course_version,
    request_id: crypto.randomUUID(),
    payload: skeleton,
  });
  return (await api.get(snapshot.course_id)).snapshot!;
}
describe('Точная арифметика и календарь', () => {
  it('складывает дробные часы без двоичной ошибки', () => {
    expect(sumHours(['0.1', '0.2', '0.3'])).toBe('0.6');
  });
  it('соблюдает границы16/500 и нормализует эквивалентные decimal', () => {
    for (const hours of ['16', '500', '16.50'])
      expect(inputSchema.parse({ ...preset('python'), total_hours: hours }).total_hours).toBe(
        hours === '16.50' ? '16.5' : hours,
      );
    for (const hours of ['15.99', '500.01', '-1'])
      expect(inputSchema.safeParse({ ...preset('python'), total_hours: hours }).success).toBe(
        false,
      );
  });
  it('раскрывает64/56/224/32 и пересчитывает выходные', () => {
    const requirements = preset('devops');
    expect(calendarCalculation(requirements)).toMatchObject({
      needed: 64,
      days: 56,
      capacity: '224',
      deficit: '32',
    });
    requirements.calendar.weekdays_only = true;
    expect(calendarCalculation(requirements)).toMatchObject({
      days: 40,
      capacity: '160',
      deficit: '96',
    });
  });
  it('распределяетPython4+10+2 и DevOps254+2 с нулевыми контактными', () => {
    expect(hourTotals(makeSkeleton(preset('python')))).toEqual({
      lecture: '4',
      practice: '10',
      lab: '0',
      self_study: '0',
      assessment: '2',
    });
    expect(hourTotals(makeSkeleton(preset('devops')))).toEqual({
      lecture: '0',
      practice: '0',
      lab: '0',
      self_study: '254',
      assessment: '2',
    });
  });
  it('сохраняет смысловой порядок массива в каноническом SHA256', async () => {
    expect(await contentHash({ b: 1, a: 2 })).toBe(await contentHash({ a: 2, b: 1 }));
    expect(await contentHash([1, 2])).not.toBe(await contentHash([2, 1]));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
describe('Согласование, задачи и версии demo', () => {
  it('до утверждения есть пять объяснений с основаниями, нет содержания', async () => {
    const snapshot = await startPython();
    expect(snapshot.skeleton.explanations).toHaveLength(5);
    expect(
      snapshot.skeleton.explanations.every((e) => e.evidence.length && e.related_ids.length),
    ).toBe(true);
    expect(snapshot.materials).toHaveLength(0);
    expect(snapshot.approval_applicable).toBe(false);
    expect(
      snapshot.skeleton.assessments.filter((a) => a.outcome_ids.includes('outcome-1')),
    ).toHaveLength(2);
  });
  it('не принимает неверный hash и не запускает содержание', async () => {
    const snapshot = await startPython();
    await expect(
      api.command({
        action: 'approve',
        course_id: snapshot.course_id,
        expected_version: snapshot.course_version,
        request_id: crypto.randomUUID(),
        payload: { skeleton_version: 1, skeleton_hash: 'incorrect' },
      }),
    ).rejects.toMatchObject({ status: 409 });
    vi.advanceTimersByTime(10000);
    expect((await api.get(snapshot.course_id)).snapshot!.materials).toHaveLength(0);
  });
  it('генерация и производные ссылки не меняют ревизию/hash, утверждение применимо', async () => {
    const initial = await startPython();
    await approve(initial);
    vi.advanceTimersByTime(1000);
    const partial = await api.get(initial.course_id);
    expect(partial.job.status).toBe('running');
    expect(partial.job.steps.length).toBeGreaterThan(0);
    expect(partial.snapshot!.materials).toHaveLength(0);
    vi.advanceTimersByTime(1500);
    const final = (await api.get(initial.course_id)).snapshot!;
    expect(final.course_version).toBe(2);
    expect(final.skeleton_version).toBe(initial.skeleton_version);
    expect(final.skeleton_hash).toBe(initial.skeleton_hash);
    expect(final.approval_applicable).toBe(true);
    expect(final.material_links.length).toBeGreaterThan(0);
    expect(snapshotSchema.safeParse(final).success).toBe(true);
    expect(final.materials.find((m) => m.type === 'test')!.questions).toHaveLength(10);
  });
  it('изменение каркаса требует нового утверждения; пояснения пересчитаны', async () => {
    const initial = await fullPython();
    const skeleton = structuredClone(initial.skeleton);
    skeleton.requirements.audience = 'Взрослые начинающие';
    const updated = await saveSkeleton(initial, skeleton);
    expect(updated.skeleton_version).toBe(initial.skeleton_version + 1);
    expect(updated.skeleton_hash).not.toBe(initial.skeleton_hash);
    expect(updated.approval_applicable).toBe(false);
    expect(updated.materials.every((m) => m.stale)).toBe(true);
    expect(updated.skeleton.explanations[0].evidence[0].text).toContain('Взрослые');
  });
  it.each([0, 1, 2, 3])(
    'аудит, чек-лист, таблица и карта согласованы: %i типов средств',
    async (count) => {
      const initial = await startPython();
      const skeleton = structuredClone(initial.skeleton);
      const outcomeId = skeleton.outcomes[0].id;
      const first = skeleton.assessments[0];
      const types = ['test', 'practical', 'project'] as const;
      skeleton.assessments = [
        ...skeleton.assessments.filter((a) => !a.outcome_ids.includes(outcomeId)),
        ...types.slice(0, count).map((type, index) => ({
          ...first,
          id: `check-${index}`,
          type,
          outcome_ids: [outcomeId],
        })),
      ];
      if (count === 1) skeleton.assessments.push({ ...first, id: 'same-type-copy' });
      const snapshot = await saveSkeleton(initial, skeleton);
      const insufficient = count < 2;
      expect(snapshot.audit.checks.find((c) => c.id === 'coverage')!.status).toBe(
        insufficient ? 'failed' : 'passed',
      );
      expect(
        generalRequirements(snapshot).find((c) => c.id === 'outcomes-assessments')!.status,
      ).toBe(insufficient ? 'problem' : 'passed');
      expect(buildCoverage(snapshot.skeleton)[0].missingAssessments).toBe(insufficient);
      expect(
        !!buildMap(snapshot.skeleton).nodes.find((n) => n.sourceId === outcomeId)!.assessmentGap,
      ).toBe(insufficient);
      if (insufficient) await expect(approve(snapshot)).rejects.toMatchObject({ status: 409 });
    },
  );
  it('ошибка часов и результат без оценивания блокируют утверждение', async () => {
    const initial = await startPython();
    const skeleton = structuredClone(initial.skeleton);
    skeleton.topics[0].hours.practice = '9';
    skeleton.assessments = skeleton.assessments.filter((a) => a.id !== 'assessment-1-b');
    const broken = await saveSkeleton(initial, skeleton);
    expect(broken.audit.checks.find((c) => c.id === 'hours')!.status).toBe('failed');
    expect(broken.audit.checks.find((c) => c.id === 'coverage')!.status).toBe('failed');
    await expect(approve(broken)).rejects.toMatchObject({ status: 409 });
  });
  it('неопределённый календарь и конфликт нельзя закрыть без решения; продление отдельно от утверждения', async () => {
    const result = await api.command({
      action: 'start',
      payload: preset('devops'),
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    let snapshot = (await api.get(result.course_id)).snapshot!;
    await expect(approve(snapshot)).rejects.toMatchObject({ status: 409 });
    const calendar = { ...snapshot.skeleton.requirements.calendar, confirmed: true };
    await api.command({
      action: 'resolve_calendar',
      course_id: result.course_id,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
      payload: { option: 'confirm', calendar },
    });
    snapshot = (await api.get(result.course_id)).snapshot!;
    expect(snapshot.skeleton.conflicts.some((c) => c.status === 'open')).toBe(true);
    await expect(approve(snapshot)).rejects.toMatchObject({ status: 409 });
    await api.command({
      action: 'resolve_calendar',
      course_id: result.course_id,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
      payload: { option: 'extend', calendar },
    });
    snapshot = (await api.get(result.course_id)).snapshot!;
    expect(calendarCalculation(snapshot.skeleton.requirements).days).toBe(64);
    expect(snapshot.skeleton.conflicts.every((c) => c.status === 'resolved')).toBe(true);
    expect(snapshot.approval_applicable).toBe(false);
    expect(
      JSON.parse(await (await api.exportJson(result.course_id, snapshot.course_version)).text())
        .skeleton.conflicts[0].decision.actor,
    ).toBe('demo-methodist');
    await approve(await settleDecisions(result.course_id));
    expect((await api.get(result.course_id)).job.status).toBe('running');
  });
  it('повтор request_id идемпотентен, другой payload отвергается', async () => {
    const request_id = crypto.randomUUID();
    const command = { action: 'start' as const, payload: preset('python'), request_id };
    const first = await api.command(command);
    const second = await api.command(command);
    expect(second.course_id).toBe(first.course_id);
    expect(second.job.id).toBe(first.job.id);
    expect(await api.list()).toHaveLength(1);
    await expect(api.command({ ...command, payload: preset('bank') })).rejects.toMatchObject({
      status: 409,
    });
  });
  it('двойное утверждение не создаёт вторую генерацию даже с новым request_id', async () => {
    const initial = await startPython();
    const first = await approve(initial);
    await expect(approve(initial)).rejects.toMatchObject({ status: 409 });
    vi.advanceTimersByTime(2500);
    const final = (await api.get(initial.course_id)).snapshot!;
    const result = await approve(final);
    expect(result.job.id).toBe(first.job.id);
    expect((await api.get(initial.course_id)).versions).toHaveLength(2);
  });
  it('наблюдение не меняет hash; блокирующее останавливает, исправление создаёт новую ревизию', async () => {
    const initial = await fullPython();
    await api.command({
      action: 'record_observation',
      course_id: initial.course_id,
      expected_version: initial.course_version,
      request_id: crypto.randomUUID(),
      payload: {
        message: 'Достаточность практики нуждается в проверке',
        element_id: 'why-reachability',
        blocking: false,
      },
    });
    let current = (await api.get(initial.course_id)).snapshot!;
    expect(current.skeleton_hash).toBe(initial.skeleton_hash);
    expect(current.skeleton_version).toBe(initial.skeleton_version);
    expect(current.approval_applicable).toBe(true);
    await api.command({
      action: 'record_observation',
      course_id: initial.course_id,
      expected_version: current.course_version,
      request_id: crypto.randomUUID(),
      payload: {
        message: 'Входной навык отсутствует у аудитории',
        element_id: 'why-reachability',
        blocking: true,
      },
    });
    current = (await api.get(initial.course_id)).snapshot!;
    expect(current.skeleton_hash).toBe(initial.skeleton_hash);
    expect(current.approval_applicable).toBe(false);
    await expect(approve(current)).rejects.toMatchObject({ status: 409 });
    await api.command({
      action: 'resolve_observation',
      course_id: current.course_id,
      expected_version: current.course_version,
      request_id: crypto.randomUUID(),
      payload: {
        issue_id: current.observations.find((i) => i.blocking)!.id,
        correction: 'Добавить вводный разбор навыка с проверкой понимания.',
      },
    });
    current = (await api.get(initial.course_id)).snapshot!;
    expect(current.skeleton_hash).not.toBe(initial.skeleton_hash);
    expect(current.skeleton_version).toBe(initial.skeleton_version + 1);
    expect(current.approval_applicable).toBe(false);
    await approve(current);
  });
  it('перезагрузка адаптера восстанавливает активную задачу и не дублирует шаги', async () => {
    const initial = await startPython();
    await approve(initial);
    vi.advanceTimersByTime(1000);
    const partial = await api.get(initial.course_id);
    api = new DemoCourseApi();
    vi.advanceTimersByTime(1500);
    const final = await api.get(initial.course_id);
    expect(final.job.id).toBe(partial.job.id);
    expect(final.job.status).toBe('succeeded');
    expect(final.versions).toHaveLength(2);
    expect((await api.get(initial.course_id)).versions).toHaveLength(2);
  });
  it('cancel/retry сохраняют ID задачи и продолжают незавершённое', async () => {
    const initial = await startPython();
    const result = await approve(initial);
    await api.command({
      action: 'cancel',
      course_id: initial.course_id,
      expected_version: initial.course_version,
      request_id: crypto.randomUUID(),
      payload: { job_id: result.job.id },
    });
    vi.advanceTimersByTime(5000);
    expect((await api.get(initial.course_id)).snapshot!.materials).toHaveLength(0);
    await api.command({
      action: 'retry',
      course_id: initial.course_id,
      expected_version: initial.course_version,
      request_id: crypto.randomUUID(),
      payload: { job_id: result.job.id },
    });
    vi.advanceTimersByTime(2500);
    const final = await api.get(initial.course_id);
    expect(final.job.id).toBe(result.job.id);
    expect(final.job.attempt).toBe(2);
    expect(final.job.status).toBe('succeeded');
  });
  it('уточняет только пять отсутствующих полей и сохраняет аудиторию/текст', async () => {
    const requirements = preset('security');
    const result = await api.command({
      action: 'start',
      request_id: crypto.randomUUID(),
      payload: requirements,
    });
    const view = await api.get(result.course_id);
    expect(view.questions).toHaveLength(5);
    expect(view.snapshot).toBeNull();
    const answer = {
      ...requirements,
      audience: 'Не должно заменить известное',
      template_id: 'acr_professional' as const,
      total_hours: '72',
      entry_level: 'Третий курс ИСиП, основы сетей/Linux',
      delivery: 'Очно в колледже',
      assessment: 'Экзамен на стенде',
    };
    await api.command({
      action: 'clarify',
      course_id: result.course_id,
      expected_version: 0,
      request_id: crypto.randomUUID(),
      payload: answer,
    });
    vi.advanceTimersByTime(500);
    const final = (await api.get(result.course_id)).snapshot!;
    expect(final.skeleton.requirements.audience).toBe(requirements.audience);
    expect(final.skeleton.requirements.request).toBe(requirements.request);
    expect(final.skeleton.requirements.total_hours).toBe('72');
  });
  it.each(['teachers', 'bank', 'devops'])(
    'поддерживает дополнительные параметры и материал %s',
    async (id) => {
      const requirements = preset(id);
      requirements.calendar = {
        ...requirements.calendar,
        confirmed: true,
        calendar_days: 90,
        daily_limit: '4',
        start: '2026-10-14',
      };
      const result = await api.command({
        action: 'start',
        payload: requirements,
        request_id: crypto.randomUUID(),
      });
      vi.advanceTimersByTime(500);
      await approve(await settleDecisions(result.course_id));
      vi.advanceTimersByTime(2500);
      const final = (await api.get(result.course_id)).snapshot!;
      expect(sumHours(Object.values(hourTotals(final.skeleton)))).toBe(requirements.total_hours);
      expect(final.sections.some((s) => s.title.includes('Выдаваемый'))).toBe(true);
      expect(
        final.materials.some(
          (m) =>
            m.type ===
            (id === 'teachers' ? 'portfolio' : id === 'devops' ? 'mentor_interview' : 'project'),
        ),
      ).toBe(true);
    },
  );
});
describe('Правки, сохранность, аудит и JSON', () => {
  it('вопрос меняет ключ/объяснение, сохраняет hash каркаса и ручной соседний материал', async () => {
    let snapshot = await fullPython();
    const manual = snapshot.materials.find((m) => m.type === 'seminar')!;
    await api.command({
      action: 'manual_material',
      course_id: snapshot.course_id,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
      payload: { material_id: manual.id, content: 'Ручное уточнение: проверить два ввода.' },
    });
    snapshot = (await api.get(snapshot.course_id)).snapshot!;
    const preview = await api.command({
      action: 'change_preview',
      course_id: snapshot.course_id,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
      payload: {
        type: 'question',
        target_id: 'question-1',
        request: 'Уточнить вопрос',
        replacement: 'Что сохраняет score = 3?',
        correct_index: 0,
        explanation: 'Имя score связано с числом 3.',
      },
    });
    expect(preview.change_plan!.requires_approval).toBe(false);
    await api.command({
      action: 'change_apply',
      course_id: snapshot.course_id,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
      payload: { change_id: preview.change_plan!.id, overwrite_manual: false },
    });
    const updated = (await api.get(snapshot.course_id)).snapshot!;
    expect(updated.approval_applicable).toBe(true);
    expect(updated.skeleton_hash).toBe(snapshot.skeleton_hash);
    expect(updated.materials.find((m) => m.id === manual.id)!.content).toBe(
      'Ручное уточнение: проверить два ввода.',
    );
    expect(updated.changes[0].preserved.every((p) => p.equal)).toBe(true);
    const exported = JSON.parse(
      await (await api.exportJson(snapshot.course_id, updated.course_version)).text(),
    );
    expect(exported.course_id).toBe(snapshot.course_id);
    expect(exported.course_version).toBe(updated.course_version);
    expect(exported.mode).toBe('demo');
    expect(exported.draft).toBe(true);
    expect(
      exported.materials.find((m: { id: string }) => m.id === 'test-final').questions[0].text,
    ).toBe('Что сохраняет score = 3?');
    expect(
      (await api.get(snapshot.course_id, snapshot.course_version)).snapshot!.materials.find(
        (m) => m.type === 'test',
      )!.questions[0].text,
    ).not.toBe(
      exported.materials.find((m: { type: string }) => m.type === 'test').questions[0].text,
    );
  });
  it('устаревший preview и expected_version не применяются', async () => {
    const snapshot = await fullPython();
    const preview = await api.command({
      action: 'change_preview',
      course_id: snapshot.course_id,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
      payload: {
        type: 'question',
        target_id: 'question-1',
        request: 'Правка',
        replacement: 'Новый вопрос',
      },
    });
    await api.command({
      action: 'audit',
      course_id: snapshot.course_id,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
      payload: {},
    });
    await expect(
      api.command({
        action: 'change_apply',
        course_id: snapshot.course_id,
        expected_version: snapshot.course_version + 1,
        request_id: crypto.randomUUID(),
        payload: { change_id: preview.change_plan!.id, overwrite_manual: false },
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(approve(snapshot)).rejects.toMatchObject({ status: 409 });
  });
  it('защищённый элемент требует отдельного согласия', async () => {
    let snapshot = await fullPython();
    await api.command({
      action: 'manual_material',
      course_id: snapshot.course_id,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
      payload: { material_id: 'test-final', content: 'Инструкция проверена методистом' },
    });
    snapshot = (await api.get(snapshot.course_id)).snapshot!;
    const preview = await api.command({
      action: 'change_preview',
      course_id: snapshot.course_id,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
      payload: {
        type: 'question',
        target_id: 'question-1',
        request: 'Правка',
        replacement: 'Новый вопрос',
      },
    });
    await expect(
      api.command({
        action: 'change_apply',
        course_id: snapshot.course_id,
        expected_version: snapshot.course_version,
        request_id: crypto.randomUUID(),
        payload: { change_id: preview.change_plan!.id, overwrite_manual: false },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('проект требует нового утверждения и корректного обновлённого содержания', async () => {
    const snapshot = await fullPython();
    const replacement = 'Только текстовая игра без внешних API; переменные, условия, циклы.';
    const preview = await api.command({
      action: 'change_preview',
      course_id: snapshot.course_id,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
      payload: {
        type: 'project',
        target_id: 'project-final',
        request: 'Изменить проект',
        replacement,
      },
    });
    await api.command({
      action: 'change_apply',
      course_id: snapshot.course_id,
      expected_version: snapshot.course_version,
      request_id: crypto.randomUUID(),
      payload: { change_id: preview.change_plan!.id, overwrite_manual: false },
    });
    const draft = (await api.get(snapshot.course_id)).snapshot!;
    expect(draft.approval_applicable).toBe(false);
    expect(draft.materials.find((m) => m.id === 'project-final')!.stale).toBe(true);
    await approve(draft);
    vi.advanceTimersByTime(2500);
    const final = (await api.get(snapshot.course_id)).snapshot!;
    expect(final.materials.find((m) => m.id === 'project-final')!.content).toContain(
      'Только текстовая игра',
    );
    expect(final.materials.find((m) => m.id === 'project-final')!.content).not.toContain(
      'API допустим',
    );
    expect(final.changes[0].preserved.every((p) => p.equal)).toBe(true);
  });
  it('неподтверждённый источник не становится экспертной проверкой', async () => {
    const snapshot = await fullPython();
    snapshot.sources.push({
      id: 'fake',
      name: 'Неподтверждённая ссылка',
      text: '',
      url: 'https://example.invalid',
      coordinate: '',
      claim: 'Не проверено',
      checked_at: new Date().toISOString(),
      scope: 'URL не получен',
      status: 'unconfirmed',
      hash: '',
    });
    const audit = auditSnapshot(snapshot);
    expect(audit.checks.find((c) => c.id === 'sources')!.status).toBe('not_run');
    expect(audit.expert_status).toBe('not_reviewed');
    expect(audit.issues.some((i) => i.id === 'source-fake')).toBe(true);
  });
  it('новая тема500ч проходит общий процесс, не подменяетсяPython', async () => {
    const r = {
      ...preset('python'),
      title: 'Архитектура распределённых систем',
      total_hours: '500',
      audience: 'Инженеры',
      calendar: { ...preset('python').calendar, calendar_days: 250, daily_limit: '4' },
    };
    const result = await api.command({
      action: 'start',
      payload: r,
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    const s = (await api.get(result.course_id)).snapshot!;
    expect(s.skeleton.topics.length).toBeGreaterThan(30);
    expect(s.skeleton.topics[0].title).toContain(r.title);
    expect(sumHours(Object.values(hourTotals(s.skeleton)))).toBe('500');
  });
});
describe('Дополнительные обязательные инварианты', () => {
  it('canonical JSON соответствует опусканию undefined в транспортном объекте', () => {
    expect(canonicalJson({ action: 'start', course_id: undefined })).toBe(
      canonicalJson({ action: 'start' }),
    );
  });
  it.each(['reduce', 'raise'] as const)(
    'явное календарное решение %s изменяет подтверждённые требования',
    async (option) => {
      const requirements = preset('devops');
      requirements.calendar.confirmed = true;
      const result = await api.command({
        action: 'start',
        payload: requirements,
        request_id: crypto.randomUUID(),
      });
      vi.advanceTimersByTime(500);
      const initial = (await api.get(result.course_id)).snapshot!;
      await api.command({
        action: 'resolve_calendar',
        course_id: result.course_id,
        expected_version: initial.course_version,
        request_id: crypto.randomUUID(),
        payload: { option, calendar: requirements.calendar },
      });
      const updated = (await api.get(result.course_id)).snapshot!;
      expect(calendarCalculation(updated.skeleton.requirements).deficit).toBe('0');
      expect(updated.skeleton.requirements.constraints).toContain('Решение методиста');
      expect(updated.approval_applicable).toBe(false);
      if (option === 'reduce') expect(updated.skeleton.requirements.total_hours).toBe('224');
      if (option === 'raise')
        expect(Number(updated.skeleton.requirements.calendar.daily_limit)).toBeGreaterThan(4);
    },
  );
  it('разные единицы часов блокируют утверждение; дробный объём суммируется точно', async () => {
    const requirements = preset('python');
    requirements.total_hours = '16.5';
    requirements.calendar.same_units = false;
    const result = await api.command({
      action: 'start',
      payload: requirements,
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    const initial = (await api.get(result.course_id)).snapshot!;
    expect(sumHours(Object.values(hourTotals(initial.skeleton)))).toBe('16.5');
    await expect(approve(initial)).rejects.toMatchObject({ status: 409 });
  });
});
describe('HTTP-контракт без скрытого demo', () => {
  it('передаёт approve один раз в /agent;202 валидируется', async () => {
    const demo = await startPython();
    const job = (await api.get(demo.course_id)).job;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ course_id: demo.course_id, job, change_plan: null }), {
        status: 202,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const http = new HttpCourseApi('/api/v1');
    await http.command({
      action: 'approve',
      course_id: demo.course_id,
      expected_version: 1,
      request_id: 'approve-id',
      payload: { skeleton_version: 1, skeleton_hash: demo.skeleton_hash },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/agent');
  });
  it.each([401, 403, 409, 413, 422, 429, 500])(
    'HTTP%s становится видимой ошибкой',
    async (status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
      await expect(new HttpCourseApi('/api/v1').get('course')).rejects.toMatchObject({ status });
    },
  );
  it('невалидныйDTO и сеть не дают успешный demo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"snapshot":{}}', { status: 200 })),
    );
    await expect(new HttpCourseApi('/api/v1').get('course')).rejects.toMatchObject({ status: 502 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(new HttpCourseApi('/api/v1').get('course')).rejects.toMatchObject({ status: 0 });
  });
});

it.each(['reduce', 'raise', 'extend'] as const)(
  'rejects unnecessary %s with 16 required and 56 available hours without saving a revision',
  async (option) => {
    const requirements = preset('python');
    requirements.total_hours = '16';
    requirements.calendar = {
      ...requirements.calendar,
      start: '2026-10-19',
      calendar_days: 7,
      daily_limit: '8',
      weekdays_only: false,
      confirmed: true,
      same_units: true,
    };
    const result = await api.command({
      action: 'start',
      payload: requirements,
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    const initial = (await api.get(result.course_id)).snapshot!;
    await expect(
      api.command({
        action: 'resolve_calendar',
        course_id: result.course_id,
        expected_version: initial.course_version,
        request_id: crypto.randomUUID(),
        payload: { option, calendar: requirements.calendar },
      }),
    ).rejects.toThrow('Часов достаточно');
    const unchanged = (await api.get(result.course_id)).snapshot!;
    expect(unchanged.course_version).toBe(initial.course_version);
    expect(unchanged.skeleton.requirements.total_hours).toBe('16');
  },
);

describe('Часы и конкретные замечания программы', () => {
  it.each([
    ['36.000', '36'],
    ['16.5', '16,5'],
    ['254', '254'],
  ])('показывает %s точно, без округления и «≈»', (value, display) => {
    expect(formatHours(value)).toBe(display);
  });
  it.each(['teachers', 'bank', 'python'])('сохраняет точное распределение и баланс %s', (id) => {
    const skeleton = makeSkeleton(preset(id));
    const before = JSON.stringify(skeleton);
    const totals = hourTotals(skeleton);
    expect(JSON.stringify(skeleton)).toBe(before);
    expect(sumHours(Object.values(totals))).toBe(skeleton.requirements.total_hours);
    for (const topic of skeleton.topics)
      expect(sumHours(Object.values(topic.hours))).toBe(topic.planned_total);
  });
  it('сообщает только о фактически отсутствующих параметрах или несовместимых единицах', () => {
    const skeleton = makeSkeleton(preset('python'));
    expect(skeleton.conflicts).toHaveLength(0);
    skeleton.requirements.calendar.confirmed = false;
    refreshExplanations(skeleton);
    expect(skeleton.conflicts.map((c) => c.expected)).toEqual([
      'Подтвердите учебные дни и нагрузку в календаре.',
    ]);
    skeleton.requirements.calendar.confirmed = true;
    skeleton.requirements.calendar.same_units = false;
    refreshExplanations(skeleton);
    expect(skeleton.conflicts.map((c) => c.id)).toEqual(['calendar-units']);
    skeleton.requirements.calendar.same_units = true;
    skeleton.requirements.calendar.start = '';
    refreshExplanations(skeleton);
    expect(skeleton.conflicts.map((c) => c.expected)).toEqual([
      'Укажите учебные дни и нагрузку в календаре.',
    ]);
  });
});

describe('Статусы отчёта проверки', () => {
  it('показывает блокер профстандарта и сохранённую причину решения', async () => {
    const result = await api.command({
      action: 'start',
      payload: preset('bank'),
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    const snapshot = (await api.get(result.course_id)).snapshot!;
    const finding = snapshot.audit.issues.find((issue) => issue.id === 'professional-standard')!;
    expect(finding.blocking).toBe(true);
    expect(
      generalRequirements(snapshot).find((item) => item.id === 'standard-exists')?.status,
    ).toBe('problem');
    finding.blocking = false;
    finding.decision = {
      reason: 'Проверено вручную по оригиналу',
      actor: 'Методист',
      at: new Date().toISOString(),
    };
    const item = generalRequirements(snapshot).find((item) => item.id === 'standard-exists')!;
    expect(item.status).toBe('passed');
    expect(item.evidence).toContain(finding.decision.reason);
  });
});

describe('Отсутствующие данные и ручные проверки', () => {
  it('не подтверждает реквизиты до создания разделов', async () => {
    const snapshot = await startPython();
    snapshot.sections = [];
    expect(
      generalRequirements(snapshot).find((item) => item.id === 'requisites-empty')?.status,
    ).toBe('not_checked');
    expect(generalRequirements(snapshot).some((item) => item.id === 'hours-topics-module')).toBe(
      false,
    );
  });
  it('называет источники без статуса', async () => {
    const snapshot = await startPython();
    snapshot.sources = [{ ...preset('bank').references[0], status: '' as Snapshot['sources'][number]['status'] }];
    const item = generalRequirements(snapshot).find((item) => item.id === 'sources-marked')!;
    expect(item.status).toBe('problem');
    expect(item.evidence).toContain(snapshot.sources[0].name);
    expect(item.evidence).not.toContain('у каждого');
  });
  it('не выдаёт историю уточнений и начальный уровень за проверенные', async () => {
    const result = await api.command({
      action: 'start',
      payload: { ...preset('security'), template_id: 'acr_professional', total_hours: '72', entry_level: 'Основы сетей', delivery: 'Очно', assessment: 'Экзамен' },
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    const snapshot = (await api.get(result.course_id)).snapshot!;
    expect(
      requestChecklist(snapshot)
        .slice(0, 4)
        .every((item) => item.status === 'not_checked'),
    ).toBe(true);
    expect(
      requestChecklist(snapshot).find((item) => item.title.startsWith('Результаты —'))?.status,
    ).toBe('not_checked');
  });
});
