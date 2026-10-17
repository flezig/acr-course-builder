// Запрет в промпте не гарантирует, что модель не придумает приказ, ГОСТ или ссылку.
// Поэтому код ищет в ответе проверяемые реквизиты и помечает те, которых не было во входных
// данных: повторить реквизит из запроса методиста модель может, придумать новый — нет.
// Текст не удаляется, чтобы методист видел, что именно написала модель.

export const UNVERIFIED_MARK = '[источник не подтверждён]';

const normativeKeyword = /(приказ|постановлени|распоряжени|закон|письм|указ|регламент)/iu;

const patterns: Array<{ kind: string; pattern: RegExp; needsContext?: RegExp }> = [
  { kind: 'федеральный закон', pattern: /(?<![\p{L}\d])\d{1,4}-ФЗ(?![\p{L}\d])/gu },
  {
    kind: 'стандарт',
    pattern:
      /ГОСТ(?:\s*Р)?(?:\s*(?:ИСО|ISO|МЭК|IEC)(?:\/(?:ИСО|ISO|МЭК|IEC))?)?\s*\d[\d.]*(?:[-–]\d{2,4})?/gu,
  },
  {
    kind: 'профстандарт',
    pattern: /(?<![\p{L}\d.])\d{2}\.\d{3}(?![\d.]*\d)/gu,
    needsContext: /(профстандарт|профессиональн\p{L}*\s+стандарт|(?<![\p{L}])ПС(?![\p{L}]))/iu,
  },
  {
    kind: 'нормативный документ',
    pattern: /№\s*\d[\d\p{L}\-/.]*/gu,
    needsContext: normativeKeyword,
  },
  { kind: 'ссылка', pattern: /\b(?:https?:\/\/|www\.)[^\s)»"'<>,;]+[^\s)»"'<>,;.]/giu },
  { kind: 'ISBN', pattern: /ISBN[\s:]*[\d\-–Xx ]{10,17}\d/gu },
  { kind: 'DOI', pattern: /\b10\.\d{4,9}\/[^\s)»"'<>,;]+/gu },
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[\s–\-/]+$/u, '')
    .replace(/\s+/g, '');

export interface UnverifiedClaim {
  kind: string;
  text: string;
}

export function findUnverifiedClaims(text: string, knownText: string): UnverifiedClaim[] {
  const known = normalize(knownText);
  const claims: UnverifiedClaim[] = [];
  for (const { kind, pattern, needsContext } of patterns)
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, match.index - 80), match.index);
      if (needsContext && !needsContext.test(before)) continue;
      const value = match[0].trim();
      if (!known.includes(normalize(value))) claims.push({ kind, text: value });
    }
  return claims;
}

export function markUnverifiedClaims(text: string, knownText: string) {
  const claims = findUnverifiedClaims(text, knownText);
  let marked = text;
  for (const claim of new Set(claims.map((c) => c.text))) {
    const escaped = claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Повторная разметка того же текста не должна дублировать пометку.
    marked = marked.replace(
      new RegExp(`${escaped}(?!\\s*\\[источник не подтверждён\\])`, 'gu'),
      `${claim} ${UNVERIFIED_MARK}`,
    );
  }
  return { text: marked, claims };
}

// Обходит все строки ответа модели и помечает неподтверждённые реквизиты на месте.
export function markClaimsDeep<T>(value: T, knownText: string, found: UnverifiedClaim[] = []): T {
  if (typeof value === 'string') {
    const result = markUnverifiedClaims(value, knownText);
    found.push(...result.claims);
    return result.text as T;
  }
  if (Array.isArray(value)) return value.map((item) => markClaimsDeep(item, knownText, found)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, markClaimsDeep(item, knownText, found)]),
    ) as T;
  return value;
}

export function describeClaims(where: string, claims: UnverifiedClaim[]) {
  const unique = [...new Map(claims.map((c) => [c.text, c])).values()];
  return unique.map(
    (c) =>
      `${where}: ${c.kind} «${c.text}» не было во входных данных — помечен как неподтверждённый, проверьте по официальному источнику.`,
  );
}
