import type { Skeleton } from '../model/schema';

// В выгрузках вместо внутренних идентификаторов вида outcome-1 нужны коды,
// которые методист видит в документе: РО 1, РО 2 и далее по порядку.
export function outcomeCodes(skeleton: Skeleton): Record<string, string> {
  return Object.fromEntries(skeleton.outcomes.map((o, index) => [o.id, `РО ${index + 1}`]));
}
