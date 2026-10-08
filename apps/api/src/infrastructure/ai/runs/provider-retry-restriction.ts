import { z } from 'zod'

import {
  type ProviderRetryHint,
  retryDateAtPgClock,
} from '../gateway/providers/provider-retry-hint'

import { writeRunSteps } from './ai-run-loop-persistence'

import { AiRunStepType, Prisma } from '@/generated/prisma/client'

const timestamp = z
  .string()
  .length(24)
  .refine((v) => {
    if (
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(v) ||
      v.startsWith('0000')
    )
      return false
    const date = new Date(v)
    return Number.isFinite(date.getTime()) && date.toISOString() === v
  })
export const providerRetryRestrictionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal('until'),
    notBefore: timestamp,
    observedAt: timestamp,
    source: z.enum(['relative', 'http_date']),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal('unknown_until'),
    observedAt: timestamp,
    reason: z.enum(['overflow', 'unsupported_header']),
  }),
])
export type ProviderRetryRestriction = z.infer<typeof providerRetryRestrictionSchema>

export interface SettledRestriction {
  now: Date
  floor: Date | null
  refused: boolean
  invalid: boolean
}

/** Called AFTER guard locks. JSON persists before exhaustion or visible-stop selection. */
export async function persistProviderRestriction(
  tx: Prisma.TransactionClient,
  runId: string,
  hint?: ProviderRetryHint
): Promise<SettledRestriction> {
  const rows = await tx.$queryRaw<{ now: Date; anchor: Date; classification: string }[]>(
    Prisma.sql`WITH timing AS MATERIALIZED (SELECT clock_timestamp() AS at) SELECT at AS now, date_trunc('milliseconds',at) + CASE WHEN at > date_trunc('milliseconds',at) THEN interval '1 millisecond' ELSE interval '0' END AS anchor, restriction.classification FROM ai.ai_runs, timing, LATERAL ai.classify_provider_retry_restriction("providerRetryRestriction", timing.at) restriction WHERE id = ${runId}`
  )
  const now = rows[0]!.now
  if (rows[0]!.classification === 'invalid')
    return { now, floor: null, refused: true, invalid: true }
  const row = await tx.aiRun.findUniqueOrThrow({
    where: { id: runId },
    select: { providerRetryRestriction: true },
  })
  const old =
    row.providerRetryRestriction === null
      ? null
      : providerRetryRestrictionSchema.safeParse(row.providerRetryRestriction)
  if (old && !old.success) return { now, floor: null, refused: true, invalid: true }
  let value: ProviderRetryRestriction | null = old?.success ? old.data : null
  const incoming = restrictionForHint(hint, now, rows[0]!.anchor)
  if (
    incoming &&
    value?.kind !== 'unknown_until' &&
    (incoming.kind === 'unknown_until' || !value || incoming.notBefore > value.notBefore)
  )
    value = incoming
  if (value && incoming)
    await tx.aiRun.update({ where: { id: runId }, data: { providerRetryRestriction: value } })
  const floor = value?.kind === 'until' ? new Date(value.notBefore) : null
  await writeRunSteps(tx, runId, [
    {
      type: AiRunStepType.FINALIZATION,
      detail: {
        kind: 'provider_retry_restriction',
        restriction: value?.kind ?? 'none',
        notBefore: floor?.toISOString() ?? null,
      },
    },
  ])
  return {
    now,
    floor,
    refused:
      value?.kind === 'unknown_until' ||
      (!!floor &&
        floor.getTime() -
          (value?.kind === 'until' && value.source === 'relative'
            ? rows[0]!.anchor.getTime()
            : now.getTime()) >
          86400000),
    invalid: false,
  }
}

function restrictionForHint(
  hint: ProviderRetryHint | undefined,
  now: Date,
  anchor: Date
): ProviderRetryRestriction | null {
  if (!hint) return null
  const base = { version: 1 as const, observedAt: now.toISOString() }
  if (hint.kind === 'unknown') return { ...base, kind: 'unknown_until', reason: hint.reason }
  const date =
    hint.kind === 'relative'
      ? new Date(anchor.getTime() + hint.seconds * 1000)
      : retryDateAtPgClock(hint, now)
  if (!date) return null
  // Round upward when serializing a floor: no sub-millisecond PG instant may be shortened.
  return {
    ...base,
    kind: 'until',
    notBefore: date.toISOString(),
    source: hint.kind === 'relative' ? 'relative' : 'http_date',
  }
}
