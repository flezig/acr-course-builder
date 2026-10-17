import type { CallLogEntry } from './llm/gateway.ts';

// Шлюз считает дневной лимит по московским суткам.
function moscowDay(iso: string) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
}

export function usageSummary(log: CallLogEntry[], now = new Date()) {
  const today = moscowDay(now.toISOString());
  const calls = log.filter((entry) => moscowDay(entry.at) === today);
  const byStep: Record<
    string,
    { calls: number; tokens: number; cost_rub: number; avg_ms: number }
  > = {};
  for (const entry of calls.filter((call) => call.status === 'ok' && !call.cached)) {
    const step = (byStep[entry.step] ??= { calls: 0, tokens: 0, cost_rub: 0, avg_ms: 0 });
    step.avg_ms = (step.avg_ms * step.calls + entry.duration_ms) / (step.calls + 1);
    step.calls++;
    step.tokens += entry.prompt_tokens + entry.completion_tokens;
    step.cost_rub += entry.cost_rub;
  }
  return {
    day: today,
    // Расход по нашему журналу; другие участники команды и ноутбуки тратят тот же лимит,
    // поэтому точный остаток виден только в карточке «LLM для команды».
    cost_rub: calls.reduce((sum, call) => sum + call.cost_rub, 0),
    daily_limit_rub: 100,
    calls: calls.length,
    cached_calls: calls.filter((call) => call.cached).length,
    failed_calls: calls.filter((call) => call.status === 'error').length,
    by_step: byStep,
  };
}
