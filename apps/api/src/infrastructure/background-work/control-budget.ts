export interface GcraRate {
  readonly intervalMs: number
  readonly burst: number
}

export type BudgetDecision =
  | { readonly accepted: true; readonly virtualTime: number }
  | { readonly accepted: false; readonly retryAfterMs: number }

/** Pure arithmetic; the PG row lock and database sample are the distributed authority. */
export function admitControlBudget(
  previousVirtualTime: number,
  dbNow: number,
  rate: GcraRate,
  cost = 1
): BudgetDecision {
  for (const value of [previousVirtualTime, dbNow, rate.intervalMs, rate.burst, cost])
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('CLOCK_UNCERTAIN')
  if (rate.intervalMs === 0 || rate.burst === 0 || cost === 0)
    throw new Error('RATE_LIMIT_EXCEEDED')
  const next = Math.max(previousVirtualTime, dbNow) + rate.intervalMs * cost
  const threshold = dbNow + rate.intervalMs * rate.burst
  if (!Number.isSafeInteger(next) || !Number.isSafeInteger(threshold))
    throw new Error('CLOCK_UNCERTAIN')
  if (next > threshold) return { accepted: false, retryAfterMs: next - threshold }
  return { accepted: true, virtualTime: next }
}
