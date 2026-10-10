import { z } from 'zod'

import { WorkPolicyError } from './work-policy-error'

import type { BackgroundEffectEvidence } from '@/generated/prisma/client'

const safeResult = z.union([
  z.strictObject({
    code: z.literal('LEGACY_REQUEST_UNKNOWN'),
    legacyAttemptsStarted: z.number().int().min(1).max(2147483647),
    retryClockSupported: z.literal(false),
  }),
  z.strictObject({
    previousCertainty: z.enum(['none', 'unknown']),
    previousUnresolved: z.number().int().min(0).max(11),
  }),
  z.strictObject({
    code: z.enum([
      'COMPLETED',
      'RATE_LIMITED',
      'TRANSIENT_FAILURE',
      'PERMANENT_FAILURE',
      'NO_CALL',
    ]),
    certainty: z.enum(['none', 'accepted', 'unknown']),
    lastAttemptId: z.uuidv7(),
    retryClockSupported: z.boolean(),
  }),
  z.strictObject({}),
])

/** Count a lossless fixed-field binary projection, not PG tuple/index/WAL size or JSON property names.
 * Identifiers/digests, all clocks, counters, uncertainty and fences remain in their existing columns.
 * Maximum: strings268 + five UUIDs80 + two hashes64 + clocks48 + integers32 + flags16 =508;
 * the legacy historical-start counter adds4, at most512.
 */
export function compactProviderEvidenceBytes(row: BackgroundEffectEvidence): number {
  const result = safeResult.safeParse(row.safeResult)
  if (!result.success) throw new WorkPolicyError('CONTENT_UNSUPPORTED')
  let bytes = 16 + ('legacyAttemptsStarted' in result.data ? 4 : 0)
  // Version, null bitmap, certainty/grant/disposition/code and result variant flags.
  for (const [value, maximum] of [
    [row.workId, 64],
    [row.jobId, 128],
    [row.jobName, 64],
  ] as const) {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || Buffer.byteLength(value) > maximum)
      throw new WorkPolicyError('CONTENT_UNSUPPORTED')
    bytes += 4 + Buffer.byteLength(value) // Explicit uint32 byte length, UTF-8 bytes.
  }
  const lastAttempt = 'lastAttemptId' in result.data ? result.data.lastAttemptId : null
  for (const value of [
    row.incarnation,
    row.queueEpoch,
    row.activeAttemptId,
    row.commandFence,
    lastAttempt,
  ]) {
    if (value !== null && !z.uuidv7().safeParse(value).success)
      throw new WorkPolicyError('CONTENT_UNSUPPORTED')
    bytes += 16 // Null is represented by the flag bitmap; reserved width remains fixed.
  }
  for (const value of [row.requestDigest, row.providerScope]) {
    if (value !== null && !/^[a-f0-9]{64}$/.test(value))
      throw new WorkPolicyError('CONTENT_UNSUPPORTED')
    bytes += 32
  }
  for (const value of [
    row.firstDispatchAt,
    row.nominalDeadline,
    row.finalizedAt,
    row.createdAt,
    row.updatedAt,
  ]) {
    if (value !== null && !Number.isSafeInteger(value.getTime()))
      throw new WorkPolicyError('CONTENT_UNSUPPORTED')
    bytes += 8
  }
  if (row.floorUpper < 0n || row.floorUpper > 9223372036854775807n)
    throw new WorkPolicyError('CONTENT_UNSUPPORTED')
  bytes += 8
  for (const value of [
    row.wireVersion,
    row.policyVersion,
    row.revision,
    row.clockPolicyVersion,
    row.autoStartsUsed,
    row.automaticLimit,
    row.unresolvedCount,
    row.logicalBytes,
  ]) {
    if (!Number.isInteger(value) || value < 0 || value > 2147483647)
      throw new WorkPolicyError('CONTENT_UNSUPPORTED')
    bytes += 4
  }
  if (
    !['none', 'reserved', 'spent'].includes(row.manualGrant) ||
    !['none', 'unknown', 'accepted'].includes(row.certainty) ||
    !['none', 'acknowledged_unknown'].includes(row.disposition) ||
    bytes > 512
  )
    throw new WorkPolicyError('CONTENT_UNSUPPORTED')
  return bytes
}
