import type { Snapshot } from '../../entities/course/model/schema';
import { canonicalJson } from '../../shared/lib/decimal';

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

// Построчный дифф через LCS: тексты материалов короткие, квадратичной таблицы достаточно.
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) lines.push({ kind: 'removed', text: a[i++] });
    else lines.push({ kind: 'added', text: b[j++] });
  }
  while (i < a.length) lines.push({ kind: 'removed', text: a[i++] });
  while (j < b.length) lines.push({ kind: 'added', text: b[j++] });
  return lines;
}

type Skeleton = Snapshot['skeleton'];
type Identified = { id: string } & Record<string, unknown>;

function isIdentifiedList(value: unknown): value is Identified[] {
  return Array.isArray(value) && value.every((item) => typeof item?.id === 'string');
}

function elementLabel(item: Identified) {
  const name = item.title || item.description || item.text || item.name;
  return typeof name === 'string' && name ? `${item.id} · ${name}` : item.id;
}

// Названия полей требований и календаря, которые методист видит в редакторе.
const fieldLabels: Record<string, string> = {
  request: 'Запрос',
  title: 'Название',
  template_id: 'Шаблон',
  audience: 'Аудитория',
  entry_level: 'Входной уровень',
  goal: 'Цель',
  total_hours: 'Объём, часов',
  delivery: 'Форма обучения',
  assessment: 'Итоговая аттестация',
  constraints: 'Ограничения',
  calendar: 'Календарь',
  description: 'Описание',
  start: 'Начало',
  calendar_days: 'Календарных дней',
  weekdays_only: 'Только будни',
  daily_limit: 'Часов в день',
  confirmed: 'Подтверждён',
  same_units: 'Единые часы',
  references: 'Источники',
};

// Полные тексты источников занимают экраны; в сводке изменений хватает начала.
const valueLimit = 160;

function valueText(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  const text = typeof value === 'object' ? canonicalJson(value) : String(value);
  return text.length > valueLimit ? `${text.slice(0, valueLimit)}…` : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Изменения одного поля каркаса в виде, понятном методисту: что добавлено, удалено
// и какие поля поменялись. Вложенные объекты вроде требований раскрываются по полям.
export function describeSkeletonField(before: unknown, after: unknown): string[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => canonicalJson(before[key]) !== canonicalJson(after[key]))
      .flatMap((key) =>
        describeSkeletonField(before[key], after[key]).map(
          (line) => `${fieldLabels[key] ?? key}: ${line}`,
        ),
      );
  }
  if (isIdentifiedList(before) && isIdentifiedList(after)) {
    const beforeById = new Map(before.map((item) => [item.id, item]));
    const afterIds = new Set(after.map((item) => item.id));
    const lines: string[] = [];
    for (const item of after) {
      const old = beforeById.get(item.id);
      if (!old) {
        lines.push(`Добавлено: ${elementLabel(item)}`);
        continue;
      }
      const fields = [...new Set([...Object.keys(old), ...Object.keys(item)])].filter(
        (key) => canonicalJson(old[key]) !== canonicalJson(item[key]),
      );
      for (const key of fields)
        lines.push(
          `${elementLabel(item)} — ${key}: ${valueText(old[key])} → ${valueText(item[key])}`,
        );
    }
    for (const item of before)
      if (!afterIds.has(item.id)) lines.push(`Удалено: ${elementLabel(item)}`);
    return lines;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const added = after.filter(
      (item) => !before.some((b) => canonicalJson(b) === canonicalJson(item)),
    );
    const removed = before.filter(
      (item) => !after.some((a) => canonicalJson(a) === canonicalJson(item)),
    );
    return [
      ...added.map((item) => `Добавлено: ${valueText(item)}`),
      ...removed.map((item) => `Удалено: ${valueText(item)}`),
    ];
  }
  return [`${valueText(before)} → ${valueText(after)}`];
}

export function changedSkeletonFields<K extends keyof Skeleton>(
  before: Skeleton,
  after: Skeleton,
  fields: readonly (readonly [K, string])[],
) {
  return fields
    .filter(([key]) => canonicalJson(before[key]) !== canonicalJson(after[key]))
    .map(([key, label]) => ({ key, label, lines: describeSkeletonField(before[key], after[key]) }));
}

// Замечания сопоставляются по id: так видно, какие закрыты, а какие появились,
// даже если их общее число не изменилось.
export function compareAudits(before: Snapshot['audit'], after: Snapshot['audit']) {
  const beforeIds = new Set(before.issues.map((issue) => issue.id));
  const afterIds = new Set(after.issues.map((issue) => issue.id));
  return {
    added: after.issues.filter((issue) => !beforeIds.has(issue.id)),
    resolved: before.issues.filter((issue) => !afterIds.has(issue.id)),
  };
}

export type DiffBlock = { kind: 'lines'; lines: DiffLine[] } | { kind: 'fold'; lines: DiffLine[] };

// Длинные участки без изменений сворачиваются, вокруг правок остаётся несколько строк контекста.
export function foldUnchanged(lines: DiffLine[], context = 2): DiffBlock[] {
  const near = lines.map((_, index) =>
    lines
      .slice(Math.max(0, index - context), index + context + 1)
      .some((line) => line.kind !== 'same'),
  );
  const blocks: DiffBlock[] = [];
  lines.forEach((line, index) => {
    const kind = near[index] ? 'lines' : 'fold';
    const last = blocks.at(-1);
    if (last?.kind === kind) last.lines.push(line);
    else blocks.push({ kind, lines: [line] });
  });
  return blocks;
}
