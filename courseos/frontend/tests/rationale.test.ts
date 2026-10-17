import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { courseMarkdown } from '../src/entities/course/export/course-markdown';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DemoCourseApi } from '../src/entities/course/api/demo-course-api';
import { HttpCourseApi } from '../src/entities/course/api/http-course-api';
import { presets } from '../src/entities/course/model/presets';
import { makeSkeleton } from '../src/entities/course/model/factory';
import { auditSnapshot, calendarCalculation, hourTotals } from '../src/entities/course/model/rules';
import {
  currentRationales,
  rationaleCoverage,
  rationaleSignature,
  skeletonElements,
  rationaleIsSupported,
} from '../src/entities/course/model/rationale';
import { contentHash, sumHours } from '../src/shared/lib/decimal';
import { skeletonSchema, snapshotSchema, type Snapshot } from '../src/entities/course/model/schema';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.values.set(k, v);
  }
  removeItem(k: string) {
    this.values.delete(k);
  }
}
let api: DemoCourseApi;
const preset = (id: string) => structuredClone(presets.find((p) => p.id === id)!.requirements);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('navigator', {});
  let id = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  );
  api = new DemoCourseApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function start(id = 'python') {
  const result = await api.command({
    action: 'start',
    payload: preset(id),
    request_id: crypto.randomUUID(),
  });
  vi.advanceTimersByTime(500);
  return (await api.get(result.course_id)).snapshot!;
}
async function save(s: Snapshot) {
  await api.command({
    action: 'save_skeleton',
    course_id: s.course_id,
    expected_version: s.course_version,
    payload: s.skeleton,
    request_id: crypto.randomUUID(),
  });
  return (await api.get(s.course_id)).snapshot!;
}
async function approve(s: Snapshot) {
  await api.command({
    action: 'approve',
    course_id: s.course_id,
    expected_version: s.course_version,
    payload: { skeleton_version: s.skeleton_version, skeleton_hash: s.skeleton_hash },
    request_id: crypto.randomUUID(),
  });
  vi.advanceTimersByTime(2500);
  return (await api.get(s.course_id)).snapshot!;
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
describe('Основания и границы подтверждения', () => {
  it.each(presets.map((example) => example.id))(
    'выгрузка примера %s начинается с описания курса и сохраняет исходные данные',
    async (id) => {
      const snap = await start();
      const requirements = preset(id);
      // Неполный пример кибербезопасности требует ответов до создания плана.
      if (id === 'security') {
        requirements.total_hours = '72';
        requirements.entry_level = 'Начальные навыки работы с компьютером';
        requirements.delivery = 'Очно';
        requirements.assessment = 'Защита учебного стенда';
        requirements.template_id = 'acr_professional';
      }
      snap.skeleton = makeSkeleton(requirements);
      snap.skeleton_hash = await contentHash(snap.skeleton);
      const before = JSON.stringify(snap);
      const report = courseMarkdown(snap);
      const introduction = report.split('## Подробные пояснения к решениям')[0];
      expect(report.startsWith(`# ${requirements.title}\n`)).toBe(true);
      expect(introduction).toContain('## Для кого и зачем этот курс');
      expect(introduction).toContain('## Как будет проходить обучение');
      expect(introduction).toContain('## Как понять, что цель достигнута');
      expect(introduction).not.toMatch(/topic-\d|outcome-\d|time_budgets|"calendar_days"/);
      expect(report).toContain(snap.skeleton_hash);
      expect(report).toContain('## Сведения о сохранённой версии');
      expect(JSON.stringify(snap)).toBe(before);
      if (id !== 'python') expect(report).not.toContain('Для Python условие');
    },
  );
  it('описывает каждый элемент и отличает ссылку от прочитанного подтверждённого фрагмента', async () => {
    const snap = await start();
    const s = snap.skeleton;
    expect(skeletonElements(s).every((e) => currentRationales(s, e.id).length)).toBe(true);
    expect(rationaleCoverage(s).expert).toBe(0);
    expect(s.assessments.every((a) => a.criterion.length > 20)).toBe(true);
    expect(s.design_stages!.map((x) => x.id)).toEqual([
      'analysis',
      'outcomes',
      'assessment_and_criteria',
      'practice',
      'content_and_prerequisites',
      'time_and_calendar',
    ]);
    const r = s.rationales!.find((r) => r.kind === 'research')!;
    r.status = 'confirmed';
    expect(rationaleIsSupported(s, r)).toBe(false); // read source still does not verify applicability
    const source = s.rationale_sources!.find((x) => x.id === r.source_id)!;
    source.provenance!.access = 'registered';
    source.text = '';
    r.input_signature = rationaleSignature(s);
    r.status = 'expert_checked';
    r.reviewer = 'Проверяющий';
    r.checked_at = '2026-10-15';
    expect(rationaleIsSupported(s, r)).toBe(false);
    expect(auditSnapshot(snap).issues.some((x) => x.id === 'unsupported-claim')).toBe(true);
    r.source_id = 'absent';
    expect(auditSnapshot(snap).issues.find((x) => x.id === 'broken-rationale')?.blocking).toBe(
      true,
    );
  });
  it('не подменяет частичное основание подтверждением и показывает пробел без источника', async () => {
    const snap = await start();
    const s = snap.skeleton;
    const research = s.rationales!.find((r) => r.kind === 'research')!;
    expect(research.status).toBe('partial');
    const target = s.outcomes[0].id;
    s.rationales = s.rationales!.filter((r) => r.element_id !== target);
    const report = courseMarkdown(snap);
    expect(report).toContain(
      `Пункт ${skeletonElements(s).findIndex((e) => e.id === target) + 1}: ${target}`,
    );
    expect(report).toContain('Основание не найдено; требуется проверка');
    expect(rationaleCoverage(s).gaps).toBeGreaterThan(0);
  });
  it('арифметика и граф проверяются отдельно от педагогического смысла', async () => {
    const snap = await start();
    expect(sumHours(Object.values(hourTotals(snap.skeleton)))).toBe('16');
    expect(auditSnapshot(snap).checks.find((x) => x.id === 'pedagogy')?.status).toBe('not_run');
    // Восемь занятий по 2 часа: семь тем и защита проекта.
    expect(snap.skeleton.topics.map((t) => t.planned_total)).toEqual(Array(8).fill('2'));
    expect(snap.skeleton.topics[4].prerequisite_ids).not.toContain('topic-4');
    snap.skeleton.topics[0].prerequisite_ids.push('topic-2');
    expect(auditSnapshot(snap).issues.find((x) => x.id === 'invalid-structure')?.blocking).toBe(
      true,
    );
    snap.skeleton.topics[0].prerequisite_ids = ['absent'];
    expect(auditSnapshot(snap).issues.find((x) => x.id === 'broken-link')?.blocking).toBe(true);
    snap.skeleton.topics[0].prerequisite_ids = [];
    // Reading a string does not require mastery of loops, though this added edge is acyclic.
    snap.skeleton.topics[4].prerequisite_ids.push('topic-4');
    const audit = auditSnapshot(snap);
    expect(audit.issues.some((x) => x.id === 'invalid-structure')).toBe(false);
    expect(audit.checks.find((x) => x.id === 'prerequisites')?.status).toBe('passed');
    expect(audit.checks.find((x) => x.id === 'pedagogy')?.status).toBe('not_run'); // acyclic but semantically wrong is not auto-approved
  });
  it.each(['audience', 'outcome', 'hours', 'source'])(
    'после изменения %s основания требуют пересмотра, старый MD сохраняется',
    async (field) => {
      const snap = await start();
      const old = await (await api.exportMarkdown(snap.course_id, snap.course_version)).text();
      const s = snap.skeleton;
      if (field === 'audience') s.requirements.audience = 'Взрослые разработчики';
      if (field === 'outcome')
        s.outcomes[0].description = 'Самостоятельно реализует новый сценарий';
      if (field === 'hours') {
        s.topics[0].hours.practice = '2';
        s.topics[0].planned_total = '3';
      }
      if (field === 'source') s.rationale_sources![0].text += ' Уточнение.';
      expect(currentRationales(s, 'goal')[0].status).toBe('stale');
      const updated = await save(snap);
      expect(updated.skeleton.rationales!.every((r) => r.status === 'stale')).toBe(true);
      expect(updated.skeleton.rationales![0].version).toBe(2);
      expect(updated.approval_applicable).toBe(false);
      expect(await (await api.exportMarkdown(snap.course_id, snap.course_version)).text()).toBe(
        old,
      );
      expect(updated.skeleton_hash).not.toBe(snap.skeleton_hash);
    },
  );
  it('старые курсы сохраняют canonical hash и утверждение при чтении новой схемой', async () => {
    const snap = await start();
    const legacy = structuredClone(snap);
    delete legacy.skeleton.rationales;
    delete legacy.skeleton.rationale_sources;
    delete legacy.skeleton.time_budgets;
    delete legacy.skeleton.dependency_reasons;
    delete legacy.skeleton.design_stages;
    const before = await contentHash(legacy.skeleton);
    expect(await contentHash(skeletonSchema.parse(legacy.skeleton))).toBe(before);
    expect(snapshotSchema.parse(legacy).skeleton.rationales).toBeUndefined();
    expect(courseMarkdown(legacy)).toContain('Основание не найдено; требуется проверка');
  });
  it('общий сценарий не получает выдуманную цепочку, а оценка часов помечена непроверенной', () => {
    const r = preset('bank');
    r.audience = 'Специалисты отдела закупок';
    r.title = 'Работа с договорами';
    const s = makeSkeleton(r);
    expect(
      s.topics.filter((t) => t.id !== 'topic-final').every((t) => !t.prerequisite_ids.length),
    ).toBe(true);
    expect(s.time_budgets!.every((b) => b.note.includes('не проверено'))).toBe(true);
    expect(s.explanations.find((e) => e.id === 'why-sequence')!.conclusion).toContain(
      'Не проверено',
    );
  });
  it('HTTP MD требует именно выбранную версию и не вызывает demo при ошибке', async () => {
    const snap = await start();
    const job = (await api.get(snap.course_id)).job;
    const fetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            snapshot: snap,
            requirements: snap.skeleton.requirements,
            course_id: snap.course_id,
            latest_version: 1,
            versions: [1],
            questions: [],
            job,
            is_latest: true,
          }),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const http = new HttpCourseApi('/api/v1');
    expect(await (await http.exportMarkdown(snap.course_id, 1)).text()).toContain(
      snap.skeleton_hash,
    );
    expect(fetch.mock.calls[0][0]).toContain('?version=1');
    await expect(http.exportMarkdown(snap.course_id, 999)).rejects.toMatchObject({ status: 409 });
    fetch.mockImplementation(async () => new Response('{}', { status: 503 }));
    await expect(http.exportMarkdown(snap.course_id, 1)).rejects.toMatchObject({ status: 503 });
  });
});
it('полный Python и DevOps; отчёт, JSON, сохранённая версия и hash согласованы', async () => {
  const initial = await start();
  const beforeApproval = await (
    await api.exportMarkdown(initial.course_id, initial.course_version)
  ).text();
  const python = await approve(initial);
  expect(await (await api.exportMarkdown(initial.course_id, initial.course_version)).text()).toBe(
    beforeApproval,
  );
  expect(python.materials.length).toBeGreaterThan(0);
  expect(python.skeleton_hash).toBe(await contentHash(python.skeleton));
  const json = JSON.parse(
    await (await api.exportJson(python.course_id, python.course_version)).text(),
  );
  const md = await (await api.exportMarkdown(python.course_id, python.course_version)).text();
  expect(md).toBe(courseMarkdown(python));
  expect(md).toContain(json.skeleton_hash);
  expect(md).toContain(`Версия курса: ${json.course_version}`);
  const devops = await start('devops');
  const r = devops.skeleton.requirements;
  r.calendar.confirmed = true;
  const confirmed = await save(devops);
  expect(calendarCalculation(confirmed.skeleton.requirements)).toMatchObject({
    needed: 64,
    days: 56,
    capacity: '224',
    deficit: '32',
  });
  await expect(approve(confirmed)).rejects.toMatchObject({ status: 409 });
  await api.command({
    action: 'resolve_calendar',
    course_id: confirmed.course_id,
    expected_version: confirmed.course_version,
    payload: { option: 'extend', calendar: confirmed.skeleton.requirements.calendar },
    request_id: crypto.randomUUID(),
  });
  const extended = (await api.get(confirmed.course_id)).snapshot!;
  expect(calendarCalculation(extended.skeleton.requirements).deficit).toBe('0');
  expect(extended.approval_applicable).toBe(false);
  const finalDevops = await approve(await settleDecisions(extended.course_id));
  expect(hourTotals(finalDevops.skeleton)).toMatchObject({
    self_study: '254',
    assessment: '2',
    lecture: '0',
    practice: '0',
  });
  if (process.env.COURSEOS_WRITE_REPORTS === '1') {
    const dir = '../reports';
    mkdirSync(dir, { recursive: true });
    const write = (name: string, s: Snapshot) => {
      writeFileSync(`${dir}/${name}.md`, courseMarkdown(s));
      writeFileSync(`${dir}/${name}.snapshot.json`, JSON.stringify(s, null, 2) + '\n');
    };
    write('skeleton-rationale', python);
    write('devops-conflict-rationale', confirmed);
    write('devops-resolved-rationale', finalDevops);
  }
});
