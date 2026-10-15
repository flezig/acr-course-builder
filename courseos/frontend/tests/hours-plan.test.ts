import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { DemoCourseApi } from '../src/entities/course/api/demo-course-api';
import { presets } from '../src/entities/course/model/presets';
import { makeSkeleton } from '../src/entities/course/model/factory';
import { allocateHours, weeklyLoad } from '../src/entities/course/model/hours-plan';
import { auditSnapshot, hourTotals, programVerdict } from '../src/entities/course/model/rules';
import { samplePlanMismatch } from '../src/entities/course/model/findings';
import { generalRequirements, requestChecklist } from '../src/entities/course/model/checklist';
import { sumHours } from '../src/shared/lib/decimal';
import type { Requirements } from '../src/entities/course/model/schema';

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
  vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('navigator', {});
  api = new DemoCourseApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Запрос 4 неполный: параметры взяты из ответов методиста в файле открытых запросов.
function requirementsFor(id: string): Requirements {
  const requirements = structuredClone(presets.find((p) => p.id === id)!.requirements);
  if (id === 'security')
    Object.assign(requirements, {
      template_id: 'acr_professional',
      total_hours: '72',
      entry_level: 'Студенты 3 курса ИСиП, знают основы сетей и Linux',
      delivery: 'Очная, занятия на базе колледжа',
      assessment: 'Экзамен с практическим заданием на стенде',
    });
  return requirements;
}
const ids = presets.map((p) => p.id);
const onStep = (value: string) => new Decimal(value).mod('0.5').eq(0);

describe('Часы как в образцах АЦР', () => {
  it.each(ids)('%s: все часы кратны 0,5 и суммы сходятся на всех уровнях', (id) => {
    const requirements = requirementsFor(id);
    const skeleton = makeSkeleton(requirements);
    for (const topic of skeleton.topics) {
      for (const value of Object.values(topic.hours)) expect(onStep(value), value).toBe(true);
      expect(sumHours(Object.values(topic.hours))).toBe(topic.planned_total);
    }
    for (const moduleId of new Set(skeleton.topics.map((t) => t.module_id))) {
      const topics = skeleton.topics.filter((t) => t.module_id === moduleId);
      expect(onStep(sumHours(topics.map((t) => t.planned_total)))).toBe(true);
    }
    expect(sumHours(Object.values(hourTotals(skeleton)))).toBe(requirements.total_hours);
    for (const budget of skeleton.time_budgets!) expect(budget.note.trim()).not.toBe('');
  });

  it.each([...ids, 'generic-16', 'generic-500'])(
    '%s: каждый результат нового черновика имеет два разных типа оценочных средств',
    async (id) => {
      const requirements = id.startsWith('generic-')
        ? {
            ...requirementsFor('python'),
            title: 'Управление учебными проектами',
            total_hours: id.split('-')[1],
          }
        : requirementsFor(id);
      const result = await api.command({
        action: 'start',
        payload: requirements,
        request_id: crypto.randomUUID(),
      });
      vi.advanceTimersByTime(500);
      const snapshot = (await api.get(result.course_id)).snapshot!;
      expect(snapshot.skeleton.outcomes.length).toBeGreaterThan(0);
      for (const outcome of snapshot.skeleton.outcomes) {
        const assessments = snapshot.skeleton.assessments.filter((a) =>
          a.outcome_ids.includes(outcome.id),
        );
        expect(new Set(assessments.map((a) => a.type)).size, outcome.id).toBeGreaterThanOrEqual(2);
        for (const assessment of assessments) {
          expect(assessment.action.trim()).not.toBe('');
          expect(assessment.criterion.trim()).not.toBe('');
          expect(
            snapshot.skeleton.topics.some(
              (topic) => topic.id === assessment.topic_id && topic.outcome_ids.includes(outcome.id),
            ),
          ).toBe(true);
        }
      }
      expect(snapshot.audit.checks.find((check) => check.id === 'coverage')!.status).toBe('passed');
      expect(
        generalRequirements(snapshot).find((check) => check.id === 'outcomes-assessments')!.status,
      ).toBe('passed');
    },
  );

  it.each(ids)('%s: в выгрузках MD и JSON нет «≈» и часов мельче 0,5', async (id) => {
    const result = await api.command({
      action: 'start',
      payload: requirementsFor(id),
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    const version = (await api.get(result.course_id)).latest_version;
    const markdown = await (await api.exportMarkdown(result.course_id, version)).text();
    const json = await (await api.exportJson(result.course_id, version)).text();
    for (const text of [markdown, json]) expect(text).not.toContain('≈');
    expect(markdown).not.toMatch(/\d[.,]\d{2,}\s*(?:ч|уч)/);
    const exported = JSON.parse(json);
    for (const topic of exported.skeleton.topics)
      for (const value of Object.values(topic.hours) as string[])
        expect(onStep(value), value).toBe(true);
  });

  it('распределяет методом наибольшего остатка без хвостов последней позиции', () => {
    expect(allocateHours(70, [12, 16, 12, 12, 10, 8], 0.5).map(String)).toEqual([
      '12',
      '16',
      '12',
      '12',
      '10',
      '8',
    ]);
    expect(allocateHours(10, [1, 1, 1], 0.5).map(String)).toEqual(['3.5', '3.5', '3']);
    expect(() => allocateHours('10.25', [1, 1], 0.5)).toThrow();
  });

  it('bank: модули различаются по видам работы, и у каждого различия есть причина', () => {
    const skeleton = makeSkeleton(requirementsFor('bank'));
    const modules = skeleton.topics.filter((t) => t.id !== 'topic-final');
    expect(modules.map((t) => t.planned_total)).toEqual(['12', '16', '12', '12', '10', '8']);
    const splits = new Set(
      modules.map((t) => `${t.hours.lecture}/${t.hours.practice}/${t.hours.self_study}`),
    );
    expect(splits.size).toBeGreaterThan(3);
    for (const topic of modules) {
      const note = skeleton.time_budgets!.find((b) => b.topic_id === topic.id)!.note;
      expect(note).not.toContain('не проверено');
      expect(note.length).toBeGreaterThan(40);
    }
    expect(weeklyLoad(skeleton).map((week) => week.total.toString())).toEqual([
      '18',
      '18',
      '18',
      '18',
    ]);
  });

  it('python: 16 ч, практики не меньше 8, восемь занятий по 2 ч за 4 недели', () => {
    const skeleton = makeSkeleton(requirementsFor('python'));
    const totals = hourTotals(skeleton);
    expect(sumHours(Object.values(totals))).toBe('16');
    expect(new Decimal(totals.practice).gte(8)).toBe(true);
    expect(skeleton.topics.map((t) => t.planned_total)).toEqual(Array(8).fill('2'));
    expect(weeklyLoad(skeleton)).toHaveLength(4);
  });

  it('devops: 254 СРС и 2 ч аттестации, контактных часов нет ни в одной строке', () => {
    const skeleton = makeSkeleton(requirementsFor('devops'));
    expect(hourTotals(skeleton)).toMatchObject({
      self_study: '254',
      assessment: '2',
      lecture: '0',
      practice: '0',
      lab: '0',
    });
    for (const topic of skeleton.topics)
      expect([topic.hours.lecture, topic.hours.practice, topic.hours.lab]).toEqual(['0', '0', '0']);
  });
});

describe('Находки агента и вердикт', () => {
  it('devops: ошибка итоговой строки образца показана и не перенесена', async () => {
    const result = await api.command({
      action: 'start',
      payload: requirementsFor('devops'),
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    const snapshot = (await api.get(result.course_id)).snapshot!;
    const finding = snapshot.audit.issues.find((i) => i.id.startsWith('sample-total'))!;
    expect(finding.message).toBe('Итоговая строка образца не сходится. Ошибка не перенесена');
    expect(finding.evidence).toContain('модуль 246 СРС, итог 66 ПР + 6 ЛБ + 174 СРС');
    expect(
      samplePlanMismatch('Раздел: ЛК 0, ПР 0, ЛБ 0, СРС 10. Итого: ЛК 0, ПР 0, ЛБ 0, СРС 10'),
    ).toBeNull();
  });

  it('bank: вердикт из одного источника ведёт к первой проблеме и снимается решениями', async () => {
    const result = await api.command({
      action: 'start',
      payload: requirementsFor('bank'),
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    let snapshot = (await api.get(result.course_id)).snapshot!;
    let verdict = programVerdict(snapshot);
    expect(verdict.kind).toBe('blocked');
    expect(verdict.title).toBe(`Блокирует: ${verdict.first!.message}`);
    expect(verdict.first!.evidence).toBeTruthy();
    const ids = snapshot.audit.issues.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['calendar-unknown', 'professional-standard']));
    expect(ids).not.toContain('audit-outcome-5');
    expect(
      snapshot.skeleton.assessments
        .filter((a) => a.outcome_ids.includes('outcome-5'))
        .map((a) => a.type),
    ).toEqual(['practical', 'project']);
    const command = (action: 'apply_finding' | 'dismiss_finding', issue_id: string) =>
      api.command({
        action,
        course_id: result.course_id,
        expected_version: snapshot.course_version,
        request_id: crypto.randomUUID(),
        payload:
          action === 'apply_finding' ? { issue_id } : { issue_id, reason: 'Код подтвердит юрист' },
      } as Parameters<typeof api.command>[0]);
    await expect(command('dismiss_finding', 'calendar-unknown')).rejects.toMatchObject({
      status: 422,
    });
    for (const [action, id] of [
      ['apply_finding', 'calendar-unknown'],
      ['dismiss_finding', 'professional-standard'],
    ] as const) {
      await command(action, id);
      snapshot = (await api.get(result.course_id)).snapshot!;
    }
    verdict = programVerdict(snapshot);
    expect(verdict.kind).toBe('ready');
    expect(verdict.title).toBe('Можно утверждать');
    const kept = snapshot.audit.issues.find((i) => i.id === 'professional-standard')!;
    expect(kept.decision!.reason).toBe('Код подтвердит юрист');
    expect(snapshot.skeleton.topics.find((t) => t.id === 'topic-5')!.control).toBe(
      'Практическое задание',
    );
    expect(snapshot.skeleton.requirements.calendar).toMatchObject({
      weekdays_only: true,
      daily_limit: '4',
      confirmed: true,
    });
    expect(auditSnapshot(snapshot).issues.some((i) => i.blocking)).toBe(false);
  });

  it('объяснения не пересказывают цифры таблицы', () => {
    for (const id of ids) {
      const skeleton = makeSkeleton(requirementsFor(id));
      for (const explanation of skeleton.explanations)
        expect(explanation.conclusion).not.toMatch(/^[\d,. +=ч]+$/);
      const sequence = skeleton.explanations.find((e) => e.id === 'why-sequence')!;
      expect(sequence.conclusion).not.toContain(' → ');
    }
    const bank = makeSkeleton(requirementsFor('bank'));
    expect(bank.explanations.find((e) => e.id === 'why-sequence')!.conclusion).toContain(
      'SQL после pandas',
    );
  });

  it('профстандарт и версии инструментов без источника помечены, коды не выдуманы', () => {
    const skeleton = makeSkeleton(requirementsFor('bank'));
    expect(skeleton.outcomes.every((o) => o.professional_standard_code === null)).toBe(true);
    expect(skeleton.tools!.every((t) => t.status === 'unconfirmed' && t.version === '')).toBe(true);
  });
});

describe('Проверка программы — зеркало чек-листа кейсодателя', () => {
  it.each(ids)('%s: каждый пункт имеет статус, доказательство и место', async (id) => {
    const result = await api.command({
      action: 'start',
      payload: requirementsFor(id),
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    const snapshot = (await api.get(result.course_id)).snapshot!;
    const items = [...generalRequirements(snapshot), ...requestChecklist(snapshot)];
    for (const item of items) {
      expect(['passed', 'problem', 'not_checked', 'manual_review']).toContain(item.status);
      expect(item.evidence.trim(), item.title).not.toBe('');
      expect(item.target.screen).toBeTruthy();
    }
  });

  it.each([
    ['demo', 'ready', 'unavailable', 'passed'],
    ['demo', 'unavailable', 'unavailable', 'problem'],
    ['demo', 'ready', 'failed', 'problem'],
    ['live', 'ready', 'unavailable', 'problem'],
    ['live', 'ready', 'ready', 'passed'],
  ] as const)('экспорт: %s, JSON %s, DOCX %s → %s', async (mode, jsonStatus, docxStatus, status) => {
    const result = await api.command({
      action: 'start',
      payload: requirementsFor('bank'),
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    const snapshot = (await api.get(result.course_id)).snapshot!;
    snapshot.mode = mode;
    snapshot.export_manifest.find((file) => file.format === 'json')!.status = jsonStatus;
    snapshot.export_manifest.find((file) => file.format === 'docx')!.status = docxStatus;
    const exportCheck = generalRequirements(snapshot).find((item) => item.id === 'exports')!;
    expect(exportCheck.status).toBe(status);
    if (mode === 'demo' && docxStatus === 'unavailable') {
      expect(exportCheck.evidence).toContain('.docx — не входит в проверку демо');
    }
  });

  it('bank: профстандарт учитывается один раз в общих требованиях', async () => {
    const result = await api.command({
      action: 'start',
      payload: requirementsFor('bank'),
      request_id: crypto.randomUUID(),
    });
    vi.advanceTimersByTime(500);
    const snapshot = (await api.get(result.course_id)).snapshot!;
    expect(generalRequirements(snapshot).map((item) => item.title)).toEqual([
      'ЛК + ПР + ЛБ + СРС равны строке',
      'Итог с итоговой аттестацией равен объёму',
      'Шаг часов 0,5 ч, как в образцах',
      'Нагрузка в день в пределах ограничения',
      'Обязательные разделы шаблона заполнены',
      'Каждый результат раскрыт хотя бы в одной теме',
      'Каждый результат проверяется двумя средствами',
      'Неподтверждённые источники помечены',
      'Профстандарт и его код существуют',
      'Реквизиты приказа, ФИО и подписи пустые',
      'Выгрузка в .docx и JSON',
      'Все материалы на русском языке',
    ]);
    const request = requestChecklist(snapshot);
    expect(request).toHaveLength(8);
    const byTitle = Object.fromEntries(request.map((item) => [item.title, item]));
    expect(byTitle['В начале — вводный блок по основам Python'].status).toBe('passed');
    expect(request.some((item) => /профстандарт/i.test(item.title))).toBe(false);
    expect(byTitle['Объём ровно 72 ч, календарь на 4 недели']).toMatchObject({
      status: 'problem',
      target: { screen: 'plan', hash: 'issue-calendar-unknown' },
    });
  });
});
