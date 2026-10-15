import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { DemoCourseApi } from '../src/entities/course/api/demo-course-api';
import { presets } from '../src/entities/course/model/presets';
import { requirementsSchema } from '../src/entities/course/model/schema';
import {
  attachedProfessionalStandards,
  isProfessionalStandardReference,
  professionalStandards,
  professionalStandardReferences,
} from '../src/entities/course/model/professional-standards';

it('Каталог содержит полные тексты четырёх документов с источниками и проверяемой целостностью', () => {
  expect(professionalStandards).toHaveLength(4);
  for (const standard of professionalStandards) {
    expect(standard.text.length).toBeGreaterThan(40000);
    for (const section of ['I. Общие сведения', 'II.', 'III.', 'IV.'])
      expect(standard.text).toContain(section);
    expect(standard.text).toContain(standard.code);
    expect(createHash('sha256').update(standard.text).digest('hex')).toBe(standard.text_sha256);
    expect(new URL(standard.source_url).hostname).toBe('mintrud.gov.ru');
    expect(standard.currency_status).toBe('requires_review');
  }
});

it('Примеры получают подходящий документ, а общеразвивающий Python остаётся без профстандарта', () => {
  for (const preset of presets) {
    const requirements = requirementsSchema.parse(preset.requirements);
    expect(
      attachedProfessionalStandards(requirements).map((standard) => standard.scenario),
    ).toEqual(preset.id === 'python' ? [] : [preset.id]);
  }
  expect(presets.find((preset) => preset.id === 'devops')!.requirements.references).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'sample-internship-ba' })]),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('Замена сохраняется в новой ревизии, сбрасывает старые коды и оставляет предыдущую версию доступной', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.useFakeTimers();
  const api = new DemoCourseApi();
  const result = await api.command({
    action: 'start',
    payload: structuredClone(presets.find((preset) => preset.id === 'teachers')!.requirements),
    request_id: crypto.randomUUID(),
  });
  vi.advanceTimersByTime(500);
  const before = (await api.get(result.course_id)).snapshot!;
  const skeleton = structuredClone(before.skeleton);
  skeleton.outcomes[0].professional_standard_code = '01.001';
  skeleton.requirements.references = [
    ...skeleton.requirements.references.filter(
      (reference) => !isProfessionalStandardReference(reference),
    ),
    ...professionalStandardReferences('devops'),
  ];
  await api.command({
    action: 'save_skeleton',
    course_id: result.course_id,
    expected_version: before.course_version,
    payload: skeleton,
    request_id: crypto.randomUUID(),
  });
  const after = (await new DemoCourseApi().get(result.course_id)).snapshot!;
  expect(after.course_version).toBe(before.course_version + 1);
  expect(after.approval_applicable).toBe(false);
  expect(
    after.skeleton.outcomes.every((outcome) => outcome.professional_standard_code === null),
  ).toBe(true);
  expect(after.sources.find(isProfessionalStandardReference)?.text).toBe(
    professionalStandards.find((standard) => standard.scenario === 'devops')!.text,
  );
  expect(
    after.audit.issues.find((issue) => issue.id === 'professional-standard')?.evidence,
  ).toContain('06.026');
  const previous = (await api.get(result.course_id, before.course_version)).snapshot!;
  expect(attachedProfessionalStandards(previous.skeleton.requirements)[0].code).toBe('01.001');
});
