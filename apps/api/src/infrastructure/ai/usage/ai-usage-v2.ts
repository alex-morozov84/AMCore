import type { AiUsage } from '../gateway/ai-gateway.types'

import type { Prisma } from '@/generated/prisma/client'

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647
    ? value
    : null
}

/** Unknown counts stay unknown; compatibility Int columns do not pretend that zero was reported. */
export function normalizeAiUsage(
  raw: {
    inputTokens?: unknown
    outputTokens?: unknown
    totalTokens?: unknown
    totalDerived?: unknown
  },
  source: AiUsage['source'] = 'reported'
): AiUsage {
  const inputTokens = count(raw.inputTokens)
  const outputTokens = count(raw.outputTokens)
  const totalTokens = count(raw.totalTokens)
  const known = [inputTokens, outputTokens, totalTokens].filter((value) => value !== null).length
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(raw.totalDerived === true &&
    totalTokens !== null &&
    inputTokens !== null &&
    outputTokens !== null &&
    totalTokens === inputTokens + outputTokens
      ? { totalDerived: true }
      : {}),
    source: known === 0 ? 'unavailable' : source,
    availability: known === 3 ? 'complete' : known === 0 ? 'unavailable' : 'partial',
  }
}

export function usageLedgerV2(
  usage: AiUsage
): Pick<
  Prisma.AiUsageLedgerCreateInput,
  'inputTokens' | 'outputTokens' | 'usageVersion' | 'providerReportedUsage'
> {
  const normalized = normalizeAiUsage(usage, usage.source)
  return {
    inputTokens: normalized.inputTokens ?? 0,
    outputTokens: normalized.outputTokens ?? 0,
    usageVersion: 2,
    providerReportedUsage: { ...normalized },
  }
}
