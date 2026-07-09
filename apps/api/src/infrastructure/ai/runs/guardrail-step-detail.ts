import { AI_RUN_GUARDRAIL_CATEGORY_CODE, AI_RUN_GUARDRAIL_MAX_CATEGORIES } from './ai-run.constants'
import type { GuardrailStepCategory } from './ai-run-dispatch.types'

/**
 * Defensively normalize guardrail categories before they are persisted into `AiRunStep.detail`
 * (Track C — ADR-054 / ADR-055, Arc D). This is the **shared content-free boundary** for every DB
 * write path that records guardrail findings — the refusal finalizer (`finalizeRefusal`) and the
 * success-path input-`flag` `GUARDRAIL_CHECK` step alike — so the invariant holds at each write, not
 * just one. Only entries whose `category` matches the bounded code grammar and whose `count` is a
 * positive safe integer survive; the list is capped. So a snippet, marker value, whitespace,
 * oversized string, or bad count can never reach durable step detail, whatever the caller passes.
 */
export function sanitizeGuardrailCategories(
  categories: GuardrailStepCategory[] | undefined
): GuardrailStepCategory[] {
  if (!Array.isArray(categories)) return []
  const clean: GuardrailStepCategory[] = []
  for (const entry of categories) {
    if (clean.length >= AI_RUN_GUARDRAIL_MAX_CATEGORIES) break
    if (
      typeof entry?.category !== 'string' ||
      !AI_RUN_GUARDRAIL_CATEGORY_CODE.test(entry.category)
    ) {
      continue
    }
    if (!Number.isSafeInteger(entry.count) || entry.count <= 0) continue
    clean.push({ category: entry.category, count: entry.count })
  }
  return clean
}
