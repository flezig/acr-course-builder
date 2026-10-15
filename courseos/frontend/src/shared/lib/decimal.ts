import Decimal from 'decimal.js';
export const hourKinds = ['lecture', 'practice', 'lab', 'self_study', 'assessment'] as const;
export const hourLabels: Record<(typeof hourKinds)[number], string> = {
  lecture: 'Лекции',
  practice: 'Практика',
  lab: 'Лабораторные',
  self_study: 'Самостоятельная',
  assessment: 'Аттестация',
};
export function sumHours(values: string[]): string {
  return values.reduce((sum, value) => sum.plus(value), new Decimal(0)).toString();
}
export function normalizeDecimal(value: string): string {
  return new Decimal(value.replace(',', '.')).toString();
}
export function subtractHours(a: string, b: string): string {
  return new Decimal(a).minus(b).toString();
}
export function decimalEqual(a: string, b: string): boolean {
  return new Decimal(a).eq(b);
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  return value === undefined ? 'null' : JSON.stringify(value);
}
export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
