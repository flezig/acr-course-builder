import { fixConsequences } from '../src/entities/course/model/finding-consequences';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import JSZip from 'jszip';
import { DemoCourseApi } from '../src/entities/course/api/demo-course-api';
import { presets } from '../src/entities/course/model/presets';
import { auditSnapshot, calendarCalculation, hourTotals } from '../src/entities/course/model/rules';
import { generalRequirements, requestChecklist } from '../src/entities/course/model/checklist';
import { makeMaterials, makeSkeleton } from '../src/entities/course/model/factory';
import {
  materialReadiness,
  questionProblems,
} from '../src/entities/course/model/material-readiness';
import { sectionCompleteness } from '../src/entities/course/model/sections';
import { proposedCalendar } from '../src/entities/course/model/findings';
import {
  explicitRequestParameters,
  summaryProblems,
} from '../src/entities/course/model/request-parameters';
import { scheduleCalculation, scheduleProblems } from '../src/entities/course/model/schedule';
import { weeklyLoad } from '../src/entities/course/model/hours-plan';
import { bankDatasets } from '../src/entities/course/model/bank-materials';
import { contentHash, sumHours } from '../src/shared/lib/decimal';
import type { CourseCommand } from '../src/entities/course/api/contract';
import type { ChangeInput, Requirements, Snapshot } from '../src/entities/course/model/schema';

let api: DemoCourseApi;
let stored: Map<string, string>;
beforeEach(() => {
  vi.useFakeTimers();
  stored = new Map();
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  api = new DemoCourseApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const preset = (id: string) => structuredClone(presets.find((p) => p.id === id)!.requirements);
async function start(requirements: Requirements = preset('python')) {
  const result = await api.command({
    action: 'start',
    payload: requirements,
    request_id: crypto.randomUUID(),
  });
  vi.advanceTimersByTime(500);
  return (await api.get(result.course_id)).snapshot!;
}
async function command(snapshot: Snapshot, input: CourseCommand) {
  return api.command({
    ...input,
    course_id: snapshot.course_id,
    expected_version: snapshot.course_version,
    request_id: crypto.randomUUID(),
  });
}
async function fullPython() {
  const initial = await start();
  await command(initial, {
    action: 'approve',
    payload: { skeleton_hash: initial.skeleton_hash, skeleton_version: initial.skeleton_version },
  });
  vi.advanceTimersByTime(2500);
  return (await api.get(initial.course_id)).snapshot!;
}
async function edit(snapshot: Snapshot, input: ChangeInput) {
  const preview = await command(snapshot, { action: 'change_preview', payload: input });
  await command(snapshot, {
    action: 'change_apply',
    payload: { change_id: preview.change_plan!.id, overwrite_manual: true },
  });
  return { snapshot: (await api.get(snapshot.course_id)).snapshot!, plan: preview.change_plan! };
}

it('DevOps: 256/4 требует 64 дня до подтверждения; предложение и подтверждение сохраняют 4', async () => {
  let snapshot = await start(preset('devops'));
  expect(snapshot.skeleton.requirements.calendar.confirmed).toBe(false);
  expect(calendarCalculation(snapshot.skeleton.requirements)).toMatchObject({
    needed: 64,
    capacity: '224',
    deficit: '32',
  });
  expect(snapshot.audit.issues.some((i) => i.id === 'calendar-capacity' && i.blocking)).toBe(true);
  expect(generalRequirements(snapshot).find((i) => i.id === 'hours-daily')!.status).toBe('problem');
  expect(proposedCalendar(snapshot.skeleton.requirements)!.daily_limit).toBe('4');
  await command(snapshot, { action: 'apply_finding', payload: { issue_id: 'calendar-unknown' } });
  snapshot = (await api.get(snapshot.course_id)).snapshot!;
  expect(snapshot.skeleton.requirements.calendar.daily_limit).toBe('4');
  expect(snapshot.skeleton.requirements.original_limits?.daily_limit).toBe('4');
  expect(snapshot.audit.issues.some((i) => i.id === 'calendar-capacity' && i.blocking)).toBe(true);
  await expect(
    command(snapshot, {
      action: 'approve',
      payload: {
        skeleton_hash: snapshot.skeleton_hash,
        skeleton_version: snapshot.skeleton_version,
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    command(snapshot, {
      action: 'resolve_calendar',
      payload: {
        option: 'confirm',
        calendar: { ...snapshot.skeleton.requirements.calendar, daily_limit: '6.5' },
      },
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it.each(['extend', 'reduce', 'raise'] as const)(
  'DevOps: явное решение %s сохраняет исходные условия и требует утверждения',
  async (option) => {
    let snapshot = await start(preset('devops'));
    await command(snapshot, {
      action: 'resolve_calendar',
      payload: {
        option,
        calendar: { ...snapshot.skeleton.requirements.calendar, confirmed: true },
      },
    });
    snapshot = (await api.get(snapshot.course_id)).snapshot!;
    expect(snapshot.skeleton.requirements.original_limits).toEqual({
      daily_limit: '4',
      calendar_days: 56,
      total_hours: '256',
    });
    expect(calendarCalculation(snapshot.skeleton.requirements).deficit).toBe('0');
    expect(snapshot.approval_applicable).toBe(false);
    expect(
      snapshot.skeleton.conflicts.find((c) => c.id === 'calendar-decision')?.decision,
    ).toMatchObject({ option_id: option });
    if (option === 'extend')
      expect(snapshot.skeleton.requirements.calendar).toMatchObject({
        daily_limit: '4',
        calendar_days: 64,
      });
  },
);
it('исключение не подтверждает профстандарт; JSON и Markdown сохраняют замечание, причину и область', async () => {
  let snapshot = await start(preset('bank'));
  await command(snapshot, {
    action: 'dismiss_finding',
    payload: {
      issue_id: 'professional-standard',
      reason: 'Коды сопоставит учебная часть перед выпуском',
    },
  });
  snapshot = (await api.get(snapshot.course_id)).snapshot!;
  const check = generalRequirements(snapshot).find((i) => i.id === 'standard-exists')!;
  expect(check.status).toBe('exception_accepted');
  expect(check.factual_status).toBe('not_checked');
  expect(snapshot.skeleton.outcomes.every((o) => o.professional_standard_code === null)).toBe(true);
  const json = JSON.parse(
    await (await api.exportJson(snapshot.course_id, snapshot.course_version)).text(),
  );
  expect(json.decisions[0]).toMatchObject({ scope_hash: snapshot.skeleton_hash });
  expect(json.decisions[0].finding).toContain('Профстандарт');
  expect(json.decisions[0].scope).toContain('Версия');
  expect(
    await (await api.exportMarkdown(snapshot.course_id, snapshot.course_version)).text(),
  ).toContain('Решение не подтверждает соответствие требованию');
  const skeleton = structuredClone(snapshot.skeleton);
  skeleton.goal += ' с другими результатами';
  await command(snapshot, { action: 'save_skeleton', payload: skeleton });
  const revised = (await api.get(snapshot.course_id)).snapshot!;
  expect(
    revised.audit.issues.find((i) => i.id === 'professional-standard')!.decision,
  ).toBeUndefined();
});
it('арифметику и календарный конфликт нельзя принять исключением', async () => {
  const snapshot = await start(preset('devops'));
  await expect(
    command(snapshot, {
      action: 'dismiss_finding',
      payload: { issue_id: 'calendar-capacity', reason: 'Согласовано' },
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it('48 ч / три недели: текст, план, календарь, аудит и экспорт используют подтверждённые параметры', async () => {
  const r = preset('bank');
  r.request = r.request.replace('72 часа', '48 часов').replace('4 недели', 'три недели');
  expect(explicitRequestParameters(r.request)).toMatchObject({ hours: '48', weeks: 3 });
  expect(summaryProblems(r).map((p) => p.id)).toEqual(['hours-text', 'weeks-text']);
  r.total_hours = '48';
  r.calendar.calendar_days = 21;
  r.calendar.daily_limit = '4';
  r.calendar.confirmed = true;
  r.calendar.description = '48 часов за три недели';
  expect(summaryProblems(r)).toEqual([]);
  // Длительность занятия и дневная нагрузка не сравниваются с объёмом курса.
  expect(
    explicitRequestParameters('Интенсив ML за 2 недели, 3 раза в неделю по 3 часа').hours,
  ).toBeUndefined();
  expect(explicitRequestParameters('Курс на 72 часа, не больше 4 часов в день').hours).toBe('72');
  const snapshot = await start(r);
  expect(sumHours(Object.values(hourTotals(snapshot.skeleton)))).toBe('48');
  expect(weeklyLoad(snapshot.skeleton)).toEqual([]);
  expect(snapshot.skeleton.requirements.calendar.calendar_days).toBe(21);
  expect(snapshot.audit.checks.find((c) => c.id === 'hours')).toMatchObject({
    expected: '48 ч',
    status: 'passed',
  });
  expect(requestChecklist(snapshot)[0]).toMatchObject({ status: 'passed' });
  const json = JSON.parse(
    await (await api.exportJson(snapshot.course_id, snapshot.course_version)).text(),
  );
  expect(json.skeleton.requirements).toMatchObject({
    total_hours: '48',
    calendar: { calendar_days: 21 },
  });
});
it('DOCX, PPTX, LMS и JSON готовы в демо после генерации материалов', async () => {
  const snapshot = await fullPython();
  const checks = generalRequirements(snapshot);
  for (const id of ['exports', 'export-pptx', 'export-lms', 'export-json'])
    expect(checks.find((c) => c.id === id)!.status).toBe('passed');
});
it('LMS-выгрузка — Moodle XML с ключами и кодами результатов', async () => {
  const snapshot = await fullPython();
  const file = snapshot.export_manifest.find((f) => f.format === 'lms')!;
  expect(file.filename).toMatch(/-moodle\.xml$/);
  const xml = await (await api.downloadFile(file.file_id!)).text();
  expect(xml.match(/<question type="multichoice">/g)).toHaveLength(10);
  expect(xml.match(/fraction="100"/g)).toHaveLength(10);
  expect(xml).toContain('<tag><text>');
  expect(xml).not.toMatch(/<text>[^<]*[<>][^<]*<\/text>/);
});
it('MD и JSON начинаются со сводки для методиста с кодами результатов', async () => {
  const snapshot = await fullPython();
  const md = await (await api.exportMarkdown(snapshot.course_id, snapshot.course_version)).text();
  const body = md.split('## Подробные пояснения к решениям')[0];
  expect(body.indexOf('## Перед утверждением: что проверить')).toBeLessThan(
    body.indexOf('## Как будет проходить обучение'),
  );
  expect(body).toContain('| 1.1 | Знакомство с Python | 2 |');
  expect(body).toContain('### Оценочные материалы');
  expect(body).not.toMatch(/outcome-\d|topic-\d/);
  const json = JSON.parse(
    await (await api.exportJson(snapshot.course_id, snapshot.course_version)).text(),
  );
  expect(json.program.outcomes.map((o: { code: string }) => o.code)).toEqual([
    'РО 1',
    'РО 2',
    'РО 3',
  ]);
  const curriculum = json.program.curriculum;
  expect(
    sumHours([
      ...curriculum.modules.map((m: { total_hours: string }) => m.total_hours),
      ...curriculum.final_attestation.map((t: { total_hours: string }) => t.total_hours),
    ]),
  ).toBe(snapshot.skeleton.requirements.total_hours);
  expect(json.skeleton_hash).toBe(snapshot.skeleton_hash);
  expect(snapshot.export_manifest.find((f) => f.format === 'docx')!.filename).toBe(
    'Первые шаги в Python — v2 — программа АЦР.docx',
  );
});
it('DOCX и PPTX собираются из выбранной версии без технических идентификаторов', async () => {
  const snapshot = await fullPython();
  // Упаковка ZIP в библиотеках выгрузки ждёт настоящих таймеров.
  vi.useRealTimers();
  const file = (format: string) =>
    api.downloadFile(snapshot.export_manifest.find((f) => f.format === format)!.file_id!);
  const unzip = async (blob: Blob) => JSZip.loadAsync(await blob.arrayBuffer());
  const docx = await unzip(await file('docx'));
  const documentXml = await docx.file('word/document.xml')!.async('string');
  expect(documentXml).toContain(snapshot.skeleton.requirements.title);
  expect(documentXml).toContain('Приказом № ____-ОБР');
  expect(documentXml).toContain('Ключ: ');
  expect(documentXml).toContain('Лист проверки методистом');
  expect(documentXml).not.toMatch(/outcome-\d|topic-\d/);
  const pptx = await unzip(await file('pptx'));
  const contentTypes = await pptx.file('[Content_Types].xml')!.async('string');
  for (const entry of contentTypes.matchAll(/<Override\b[^>]*PartName="([^"]+)"/g))
    expect(pptx.file(entry[1].slice(1)), entry[1]).not.toBeNull();
  const lecture = snapshot.materials.find((m) => m.type === 'lecture' && m.slides.length)!;
  const slides = await Promise.all(
    Object.keys(pptx.files)
      .filter((name) => /^ppt\/(slides|notesSlides)\/\w+\.xml$/.test(name))
      .map((name) => pptx.file(name)!.async('string')),
  );
  expect(slides.join('')).toContain(lecture.slides[0].title);
  if (process.env.COURSEOS_EXPORT_DIR) {
    const { writeFile } = await import('node:fs/promises');
    for (const format of ['docx', 'pptx'])
      await writeFile(
        `${process.env.COURSEOS_EXPORT_DIR}/sample.${format}`,
        Buffer.from(await (await file(format)).arrayBuffer()),
      );
  }
});
it('повторы под разными заголовками и пустые обязательные поля оставляют программу незавершённой', async () => {
  const snapshot = await fullPython();
  const distinct = snapshot.sections.find((s) => s.title.includes('Цель'))!;
  // В тексте раздела цель продолжает фразу «Цель программы – …», поэтому со строчной.
  expect(distinct.content).toContain(snapshot.skeleton.goal.slice(1));
  expect(snapshot.sections.find((s) => s.title === '2.1 Учебный план')!.content).toContain(
    'Аттестация 2',
  );
  for (const section of snapshot.sections) section.content = 'Один и тот же общий текст программы';
  expect(sectionCompleteness(snapshot).every((s) => !s.complete)).toBe(true);
  expect(auditSnapshot(snapshot).checks.find((c) => c.id === 'sections')!.status).toBe('failed');
  expect(auditSnapshot(snapshot).technical_ready).toBe(false);
});
it('удаление реально созданного оценочного материала при сохранённой декларации выявляется', async () => {
  const snapshot = await fullPython();
  expect(materialReadiness(snapshot).complete).toBe(true);
  snapshot.materials = snapshot.materials.filter((m) => m.id !== 'test-final');
  expect(materialReadiness(snapshot).missingAssessments.length).toBe(3);
  expect(auditSnapshot(snapshot).checks.find((c) => c.id === 'sections')!.status).toBe('failed');
});
it('банковский JOIN, даты оттока, суммы и сегменты вычисляются на предоставленных таблицах', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE clients(client_id TEXT PRIMARY KEY,segment TEXT,last_operation_date TEXT,deposit REAL); CREATE TABLE loans(loan_id TEXT PRIMARY KEY,client_id TEXT,product TEXT,loan_amount REAL,debt REAL,overdue_days INTEGER)',
  );
  const clients = db.prepare('INSERT OR IGNORE INTO clients VALUES(?,?,?,?)');
  for (const row of bankDatasets[0].rows) clients.run(...row);
  const loans = db.prepare('INSERT INTO loans VALUES(?,?,?,?,?,?)');
  for (const row of bankDatasets[1].rows) loans.run(...row);
  expect(db.prepare('SELECT SUM(deposit) AS total,COUNT(*) AS n FROM clients').get()).toMatchObject(
    { total: 14000, n: 12 },
  );
  expect(
    db
      .prepare(
        "SELECT client_id FROM clients WHERE julianday('2026-10-01')-julianday(last_operation_date)>90 ORDER BY client_id",
      )
      .all()
      .map((r) => r.client_id),
  ).toEqual(['A02', 'A04', 'A07', 'A09', 'A11']);
  expect(
    db.prepare('SELECT COUNT(*) AS n FROM loans l JOIN clients c ON l.client_id=c.client_id').get()!
      .n,
  ).toBe(12);
  expect(
    db
      .prepare(
        'SELECT product,SUM(debt) AS debt FROM loans WHERE overdue_days>30 GROUP BY product ORDER BY product',
      )
      .all(),
  ).toEqual([
    { product: 'card', debt: 1400 },
    { product: 'cash', debt: 8200 },
  ]);
  expect(
    db
      .prepare(
        'SELECT segment,COUNT(*) AS n,SUM(overdue_days>30) AS late FROM loans l JOIN clients c ON l.client_id=c.client_id GROUP BY segment ORDER BY segment',
      )
      .all(),
  ).toEqual([
    { segment: 'A', n: 6, late: 2 },
    { segment: 'B', n: 6, late: 3 },
  ]);
  db.close();
});
it('банк: задания и итоговый проект содержат утверждённые артефакты и критерии', async () => {
  const skeleton = makeSkeleton(preset('bank'));
  const materials = await makeMaterials(skeleton);
  for (const material of materials.filter((m) => m.type === 'seminar')) {
    expect(material.datasets?.map((d) => d.name)).toEqual(['clients', 'loans']);
    expect(material.content).not.toContain('A01/A02/A03');
    expect(material.expected.length).toBeGreaterThan(30);
  }
  const project = materials.find((m) => m.id === 'project-final')!;
  expect(project.content).toBe(skeleton.topics.at(-1)!.content);
  for (const text of ['notebook', 'SQL', '3–5 графиков', 'одну страницу', 'Критерии защиты'])
    expect(project.content).toContain(text);
});
it.each(['bank', 'teachers', 'security', 'python'])(
  '%s: предметные вопросы, действительные ключи, связи и порог',
  async (kind) => {
    const r = preset(kind);
    if (kind === 'security')
      Object.assign(r, {
        template_id: 'acr_professional',
        total_hours: '72',
        entry_level: 'Сети/Linux',
        delivery: 'Очно',
        assessment: 'Экзамен',
      });
    const skeleton = makeSkeleton(r);
    const material = (await makeMaterials(skeleton)).find((m) => m.type === 'test')!;
    expect(material.questions.length).toBeGreaterThanOrEqual(5);
    expect(questionProblems(material, new Set(skeleton.outcomes.map((o) => o.id)))).toEqual([]);
    expect(material.test_policy!.pass_count).toBeLessThanOrEqual(material.questions.length);
    expect(material.content).toContain(`Вопросов: ${material.questions.length}`);
    expect(material.content).toContain(`порог: ${material.test_policy!.pass_count}`);
    expect(new Set(material.questions.map((q) => q.correct_index)).size).toBeGreaterThan(1);
    expect(material.questions.every((q) => !q.text.startsWith('Как проверить результат'))).toBe(
      true,
    );
    for (const outcome of skeleton.outcomes)
      expect(material.questions.some((q) => q.outcome_ids.includes(outcome.id))).toBe(true);
  },
);
it('неизвестный курс не получает универсальный тест вместо предметной разработки', async () => {
  const r = preset('python');
  r.title = 'Распределённые системы';
  r.calendar.schedule = undefined;
  const skeleton = makeSkeleton(r);
  const material = (await makeMaterials(skeleton)).find((m) => m.type === 'test')!;
  expect(material.questions).toEqual([]);
  expect(material.content).toContain('не разработан');
  expect(material.test_policy).toBeUndefined();
});
it('ключ, варианты и объяснение выбранного вопроса меняются в обоих экспортных форматах; прочие материалы сохранены', async () => {
  const base = await fullPython();
  const result = await edit(base, {
    type: 'question',
    target_id: 'question-1',
    request: 'Исправить предметный вопрос',
    replacement: 'Чему равно 3 * 4?',
    options: ['7', '12', '34'],
    correct_index: 1,
    explanation: 'Произведение равно двенадцати.',
    outcome_ids: ['outcome-1'],
    manual: true,
  });
  expect(result.plan.requires_approval).toBe(false);
  const material = result.snapshot.materials.find((m) => m.id === 'test-final')!;
  expect(material.questions[0]).toMatchObject({ correct_index: 1, options: ['7', '12', '34'] });
  expect(material.manual).toBe(true);
  for (const m of base.materials.filter((m) => m.id !== 'test-final'))
    expect(result.snapshot.materials.find((n) => n.id === m.id)!.hash).toBe(m.hash);
  const json = JSON.parse(
    await (await api.exportJson(base.course_id, result.snapshot.course_version)).text(),
  );
  expect(
    json.materials.find((m: { id: string }) => m.id === 'test-final').questions[0].correct_index,
  ).toBe(1);
  const md = await (
    await api.exportMarkdown(base.course_id, result.snapshot.course_version)
  ).text();
  expect(md).toContain('Ключ: 2. Произведение равно двенадцати.');
  await expect(
    command(result.snapshot, {
      action: 'change_preview',
      payload: {
        type: 'question',
        target_id: 'question-1',
        request: 'Неверный ключ',
        replacement: 'Чему равно 3 * 4?',
        correct_index: 5,
      },
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it('выбранный слайд меняется, другие слайды и ручные материалы сохраняются', async () => {
  const base = await fullPython();
  const lecture = base.materials.find((m) => m.slides.length)!;
  const slide = lecture.slides[0];
  const result = await edit(base, {
    type: 'slide',
    target_id: slide.id,
    request: 'Уточнить пример',
    replacement: 'Первый запуск',
    slide: {
      title: 'Первый запуск',
      bullets: ['print(3 + 4) выводит 7'],
      notes: 'Попросите предсказать вывод.',
    },
    manual: true,
  });
  const updated = result.snapshot.materials.find((m) => m.id === lecture.id)!;
  expect(updated.slides[0]).toMatchObject({
    title: 'Первый запуск',
    notes: 'Попросите предсказать вывод.',
  });
  expect(updated.slides.slice(1)).toEqual(lecture.slides.slice(1));
  expect(result.plan.requires_approval).toBe(false);
  expect(result.snapshot.skeleton_hash).toBe(base.skeleton_hash);
});
it('критерии задания обновляют план оценивания и требуют нового утверждения без потери правок', async () => {
  const base = await fullPython();
  const result = await edit(base, {
    type: 'assignment',
    target_id: 'project-final',
    request: 'Уточнить защиту',
    replacement: 'Покажите игру на двух вводах.',
    expected: 'Игра и журнал двух запусков',
    criteria: ['Обе ветки выполняются; выход завершает цикл'],
    manual: true,
  });
  expect(result.plan.requires_approval).toBe(true);
  expect(result.snapshot.approval_applicable).toBe(false);
  expect(
    result.snapshot.skeleton.assessments
      .filter((a) => a.topic_id === 'topic-final')
      .every((a) => a.criterion === 'Обе ветки выполняются; выход завершает цикл'),
  ).toBe(true);
  expect(result.snapshot.materials.find((m) => m.id === 'project-final')!.manual).toBe(true);
});
it('Python: восемь занятий по 2 ч, два в неделю; аттестация учтена один раз', async () => {
  const snapshot = await start();
  const sessions = snapshot.skeleton.sessions!;
  expect(sessions).toHaveLength(8);
  expect(new Set(sessions.map((s) => new Date(s.date).getUTCDay()))).toEqual(new Set([3, 6]));
  expect(sessions.every((s) => sumHours(Object.values(s.hours)) === '2')).toBe(true);
  expect(weeklyLoad(snapshot.skeleton).map((w) => w.total.toString())).toEqual([
    '4',
    '4',
    '4',
    '4',
  ]);
  expect(sumHours(sessions.map((s) => s.hours.assessment))).toBe('2');
  expect(scheduleProblems(snapshot.skeleton)).toEqual([]);
  snapshot.skeleton.sessions![0].hours.lecture = '9';
  expect(auditSnapshot(snapshot).issues.some((i) => i.id === 'schedule-hours' && i.blocking)).toBe(
    true,
  );
});
it('неизвестное расписание не заменяется заполнением первых свободных дней', async () => {
  const snapshot = await start(preset('bank'));
  expect(snapshot.skeleton.sessions).toEqual([]);
});
it('архив возвращает требования и скачиваемые данные выбранной версии', async () => {
  const before = await start();
  const skeleton = structuredClone(before.skeleton);
  skeleton.goal = 'Другая цель';
  await command(before, { action: 'save_skeleton', payload: skeleton });
  const archive = await api.get(before.course_id, before.course_version);
  expect(archive.requirements.goal).toBe(before.skeleton.requirements.goal);
  const json = JSON.parse(
    await (await api.exportJson(before.course_id, before.course_version)).text(),
  );
  expect(json.course_version).toBe(before.course_version);
  expect(json.skeleton.goal).toBe(before.skeleton.goal);
});
it('совместимое v1 мигрирует, повреждённый курс изолируется и остаётся в исходном архиве', async () => {
  const snapshot = await fullPython();
  const db = JSON.parse(stored.get('courseos-demo-v1')!);
  delete db.schema_version;
  delete db.courses[snapshot.course_id].snapshots[0].observations;
  db.courses.broken = { title: 'Невосстановленная работа', unknown: ['не удалять'] };
  stored.set('courseos-demo-v1', JSON.stringify(db));
  api = new DemoCourseApi();
  expect(await api.list()).toHaveLength(1);
  const migrated = JSON.parse(stored.get('courseos-demo-v1')!);
  expect(migrated.schema_version).toBe(2);
  expect(migrated.recovery.broken).toEqual(db.courses.broken);
  expect((await api.get(snapshot.course_id, 1)).snapshot!.skeleton_hash).toBe(
    db.courses[snapshot.course_id].snapshots[0].skeleton_hash,
  );
});
it('повреждённый JSON не удаляется и остаётся доступен до сброса', async () => {
  stored.set('courseos-demo-v1', '{исходная работа');
  await expect(api.list()).rejects.toMatchObject({ status: 422 });
  expect(stored.get('courseos-demo-v1')).toBe('{исходная работа');
});
it('история свыше 15 версий не обрезается автоматически; сокращение защищает утверждённую версию', async () => {
  let snapshot = await fullPython();
  const approvedVersion = snapshot.course_version;
  for (let index = 0; index < 18; index++) {
    const skeleton = structuredClone(snapshot.skeleton);
    skeleton.goal = `Изменённая цель ${index}`;
    await command(snapshot, { action: 'save_skeleton', payload: skeleton });
    snapshot = (await api.get(snapshot.course_id)).snapshot!;
  }
  expect((await api.get(snapshot.course_id)).versions).toHaveLength(20);
  await expect(
    command(snapshot, {
      action: 'prune_history',
      payload: { keep_versions: [], archive_saved: false },
    }),
  ).rejects.toMatchObject({ status: 422 });
  const archived = stored.get('courseos-demo-v1')!;
  await command(snapshot, {
    action: 'prune_history',
    payload: { keep_versions: [], archive_saved: true },
  });
  const remaining = (await api.get(snapshot.course_id)).versions;
  expect(remaining).toContain(approvedVersion);
  expect(JSON.parse(archived).courses[snapshot.course_id].snapshots).toHaveLength(20);
  expect(
    await contentHash((await api.get(snapshot.course_id, approvedVersion)).snapshot!.skeleton),
  ).toBe((await api.get(snapshot.course_id, approvedVersion)).snapshot!.skeleton_hash);
});

it('слишком длинное продление отклоняется до сохранения некорректного курса', async () => {
  const snapshot = await start(preset('devops'));
  await expect(
    command(snapshot, {
      action: 'resolve_calendar',
      payload: {
        option: 'extend',
        calendar: {
          ...snapshot.skeleton.requirements.calendar,
          daily_limit: '0.01',
          confirmed: true,
        },
      },
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect((await api.get(snapshot.course_id)).versions).toEqual([snapshot.course_version]);
});

it.each(['extend', 'raise'] as const)(
  'решение %s устраняет нехватку занятий, даже когда общей вместимости достаточно',
  async (option) => {
    const requirements = preset('teachers');
    requirements.total_hours = '36';
    requirements.calendar = {
      ...requirements.calendar,
      start: '2026-10-15',
      calendar_days: 20,
      daily_limit: '5',
      weekdays_only: false,
      confirmed: true,
      same_units: true,
      schedule: { weekdays: [3, 6], sessions_per_week: 2, duration: '2', confirmed: true },
    };
    const initial = await start(requirements);
    expect(calendarCalculation(requirements).capacity).toBe('100');
    expect(scheduleCalculation(requirements.calendar, '36')!.deficit).toBe('26');
    expect(
      initial.audit.issues.some((issue) => issue.id === 'schedule-hours' && issue.blocking),
    ).toBe(true);
    await command(initial, {
      action: 'resolve_calendar',
      payload: { option, calendar: requirements.calendar },
    });
    const updated = (await api.get(initial.course_id)).snapshot!;
    expect(updated.skeleton.requirements.total_hours).toBe('36');
    expect(scheduleCalculation(updated.skeleton.requirements.calendar, '36')!.deficit).toBe('0');
    expect(scheduleProblems(updated.skeleton)).toEqual([]);
    expect(
      sumHours(updated.skeleton.sessions!.flatMap((session) => Object.values(session.hours))),
    ).toBe('36');
    expect(updated.audit.issues.some((issue) => issue.id === 'schedule-hours')).toBe(false);
  },
);

it('пустое или противоречивое подтверждённое расписание не скрывает блокировку', async () => {
  const initial = await start();
  initial.skeleton.sessions = [];
  expect(scheduleProblems(initial.skeleton).length).toBeGreaterThan(0);
  initial.skeleton.requirements.calendar.weekdays_only = true;
  expect(scheduleCalculation(initial.skeleton.requirements.calendar, '16')!.error).toContain(
    'Уберите выходные',
  );
  await expect(
    command(initial, {
      action: 'resolve_calendar',
      payload: { option: 'confirm', calendar: initial.skeleton.requirements.calendar },
    }),
  ).rejects.toMatchObject({ status: 422 });
});

it('явно согласованный новый дневной лимит сохраняется, даже если после ввода нехватка уже исчезла', async () => {
  const initial = await start();
  await command(initial, {
    action: 'resolve_calendar',
    payload: {
      option: 'raise',
      calendar: { ...initial.skeleton.requirements.calendar, daily_limit: '5', confirmed: true },
    },
  });
  const updated = (await api.get(initial.course_id)).snapshot!;
  expect(updated.skeleton.requirements.calendar.daily_limit).toBe('5');
  expect(scheduleProblems(updated.skeleton)).toEqual([]);
});
it('проблемы сводки предлагают исправление в один клик', () => {
  const r = preset('bank');
  r.request = 'Интенсив ML за 2 недели, 3 раза в неделю по 2 часа';
  r.total_hours = '12';
  r.calendar.calendar_days = 14;
  expect(summaryProblems(r)).toEqual([
    expect.objectContaining({ id: 'hours-min', fix: { label: 'Сделать 16 ч', total_hours: '16' } }),
  ]);
  r.total_hours = '16.3';
  expect(summaryProblems(r)[0]).toMatchObject({ id: 'hours-step', fix: { total_hours: '16.5' } });
  r.request = 'Курс на 72 часа за 4 недели';
  r.total_hours = '80';
  r.calendar.calendar_days = 21;
  expect(summaryProblems(r).map((p) => p.fix)).toEqual([
    { label: 'Взять 72 ч из текста', total_hours: '72' },
    { label: 'Взять 4 нед. из текста', calendar_days: 28 },
  ]);
});
it('карточка предложения заранее говорит, что изменится после применения', async () => {
  const snapshot = await start(preset('devops'));
  const issue = snapshot.audit.issues.find((i) => i.id === 'calendar-unknown')!;
  const changes = fixConsequences(snapshot, issue);
  expect(changes[0]).toMatch(/^Календарь будет подтверждён: .*до 4 ч в день\.$/);
  expect(changes).toContain('Часы, темы и результаты не изменятся.');
  expect(changes).toContain(
    'Нехватка 32 ч останется: следующим решением нужно будет продлить срок, сократить объём или поднять дневной лимит.',
  );
  expect(changes).toContain(
    `Появится версия ${snapshot.course_version + 1}; текущая останется в истории.`,
  );
  // Находка без предложения агента не обещает изменений.
  const manual = snapshot.audit.issues.find((i) => !i.fix);
  if (manual) expect(fixConsequences(snapshot, manual)).toEqual([]);
});

it('серьёзная самопроверка блокирует комплект до решения методиста для текущих материалов', async () => {
  let snapshot = await fullPython();
  const { canonicalJson } = await import('../src/shared/lib/decimal');
  const { reviewRequest } = await import('../src/entities/course/model/generated-materials');
  snapshot.generation = {
    calls: [],
    issues: [],
    failed: [],
    review: {
      summary: 'Неверный ключ',
      complete: true,
      checked_signature: canonicalJson(reviewRequest(snapshot.skeleton, snapshot.materials)),
      issues: [
        {
          severity: 'error',
          element: 'Вопрос 1',
          message: 'Ключ противоречит объяснению',
          fix: 'Сверить ключ с вычислением',
          resolved: true,
        },
      ],
    },
  };
  snapshot.audit = auditSnapshot(snapshot);
  expect(snapshot.audit.technical_ready).toBe(false);
  expect(snapshot.audit.issues.find((i) => i.id === 'llm-review-1')?.blocking).toBe(true);
  const state = (await api.exportState(snapshot.course_id)) as { snapshots: Snapshot[] };
  state.snapshots[state.snapshots.length - 1] = snapshot;
  await api.restoreState(snapshot.course_id, state);
  await expect(
    command(snapshot, {
      action: 'dismiss_finding',
      payload: { issue_id: 'llm-review-1', reason: 'Автоматически', actor: 'automatic-api' },
    }),
  ).rejects.toMatchObject({ status: 422 });
  await command(snapshot, {
    action: 'dismiss_finding',
    payload: {
      issue_id: 'llm-review-1',
      reason: 'Методист пересчитал пример: ключ верен, замечание отклонено',
      resolution: 'rejected',
      actor: 'methodist',
    },
  });
  snapshot = (await api.get(snapshot.course_id)).snapshot!;
  expect(snapshot.audit.issues.find((i) => i.id === 'llm-review-1')?.blocking).toBe(false);
  expect(snapshot.decisions.at(-1)?.scope).toContain('Версия комплекта');
  expect(snapshot.decisions.at(-1)?.resolution).toBe('rejected');
  expect(snapshot.generation?.review?.issues).toHaveLength(1);
  snapshot.materials[0].hash = 'new-material-version';
  expect(auditSnapshot(snapshot).issues.find((i) => i.id === 'llm-review-1')?.blocking).toBe(true);
});

it('сбой и устаревшая самопроверка не дают готовность', async () => {
  const snapshot = await fullPython();
  snapshot.generation = {
    calls: [],
    issues: [],
    failed: ['Самопроверка: шлюз недоступен'],
    review: null,
  };
  expect(auditSnapshot(snapshot).technical_ready).toBe(false);
  snapshot.generation.failed = [];
  snapshot.generation.review = {
    summary: 'Замечаний нет',
    issues: [],
    complete: true,
    checked_signature: 'previous-version',
  };
  expect(auditSnapshot(snapshot).technical_ready).toBe(false);
  expect(auditSnapshot(snapshot).checks.find((c) => c.id === 'content-review')?.status).toBe(
    'failed',
  );
});

it('DOCX и Markdown сохраняют исходные даты и строки CSV без пунктуации списка', async () => {
  const snapshot = await fullPython();
  vi.useRealTimers();
  const csv =
    'transaction_id,client_id,amount,date,status\n1,101,100.00,2026-01-03,completed\n2,102,,2026-01-15,';
  snapshot.materials.find((m) => m.type === 'seminar')!.content =
    `Сохраните учебные данные в UTF-8.\n${csv}\nРассчитайте сумму.`;
  const { buildProgramDocx } = await import('../src/entities/course/export/program-docx');
  const { courseMarkdown } = await import('../src/entities/course/export/course-markdown');
  const docx = await JSZip.loadAsync(await (await buildProgramDocx(snapshot)).arrayBuffer());
  const xml = await docx.file('word/document.xml')!.async('string');
  expect(xml).toContain('1,101,100.00,2026-01-03,completed</w:t>');
  expect(xml).toContain('2,102,,2026-01-15,</w:t>');
  expect(courseMarkdown(snapshot).replace(/ +\n/g, '\n')).toContain(csv);
});
