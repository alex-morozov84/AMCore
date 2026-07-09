import type { GuardResult, GuardVerdict } from './guardrail.types'

/**
 * Accumulates content-free guard findings as `category → count` (Track C — ADR-054 / ADR-055,
 * Arc D). It only ever holds bounded category codes and integer counts — never a prompt/output
 * snippet, matched substring, or marker value — so a `GuardResult` it produces is safe to log, put
 * in `AiRunStep.detail`, or count as a metric.
 */
export class CategoryTally {
  private readonly counts = new Map<string, number>()

  /** Record one signal for a bounded category code. */
  add(category: string): void {
    this.counts.set(category, (this.counts.get(category) ?? 0) + 1)
  }

  /** Whether any signal fired for a category. */
  has(category: string): boolean {
    return this.counts.has(category)
  }

  /** Number of distinct categories that fired. */
  get size(): number {
    return this.counts.size
  }

  /** Project to a content-free result under the caller-decided verdict. */
  toResult(verdict: GuardVerdict): GuardResult {
    return {
      verdict,
      categories: [...this.counts].map(([category, count]) => ({ category, count })),
    }
  }
}
