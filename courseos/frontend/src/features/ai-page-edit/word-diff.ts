export interface DiffPart {
  text: string;
  changed: boolean;
}

/**
 * Пословное сравнение для подсветки как на GitHub: возвращает старую и новую
 * строку, где изменённые слова помечены. Пробелы считаются отдельными токенами,
 * чтобы склейка частей давала исходный текст без потерь.
 */
export function wordDiff(before: string, after: string) {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  // Классическая таблица наибольшей общей подпоследовательности: тексты полей короткие.
  const common = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      common[i][j] =
        a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  const removed: DiffPart[] = [];
  const added: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push(removed, a[i++], false);
      push(added, b[j++], false);
    } else if (j < b.length && (i === a.length || common[i][j + 1] >= common[i + 1][j]))
      push(added, b[j++], true);
    else push(removed, a[i++], true);
  }
  return { removed, added };
}

function push(parts: DiffPart[], text: string, changed: boolean) {
  const last = parts[parts.length - 1];
  if (last && last.changed === changed) last.text += text;
  else parts.push({ text, changed });
}
