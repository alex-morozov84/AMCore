import { compactProviderEvidenceBytes } from './compact-provider-evidence'

import type { BackgroundEffectEvidence } from '@/generated/prisma/client'

describe('Protected provider evidence logical representation', () => {
  const uuid = '019a1234-1234-7123-8123-123456789012'
  const row: BackgroundEffectEvidence = {
    workId: 'w'.repeat(64),
    jobId: 'j'.repeat(128),
    jobName: 'n'.repeat(64),
    incarnation: uuid,
    queueEpoch: uuid,
    activeAttemptId: uuid,
    commandFence: uuid,
    requestDigest: 'a'.repeat(64),
    providerScope: 'b'.repeat(64),
    firstDispatchAt: new Date(0),
    nominalDeadline: new Date(86400000),
    finalizedAt: new Date(86400001),
    createdAt: new Date(0),
    updatedAt: new Date(86400001),
    floorUpper: 9223372036854775807n,
    wireVersion: 2147483647,
    policyVersion: 2147483647,
    revision: 2147483647,
    clockPolicyVersion: 2147483647,
    autoStartsUsed: 10,
    automaticLimit: 10,
    unresolvedCount: 11,
    logicalBytes: 512,
    manualGrant: 'spent',
    certainty: 'unknown',
    disposition: 'acknowledged_unknown',
    outcomeRecorded: false,
    safeResult: {
      code: 'TRANSIENT_FAILURE',
      certainty: 'unknown',
      lastAttemptId: uuid,
      retryClockSupported: true,
    },
  }

  it('bounds the maximum identifiers and all populated safety fields within512 logical bytes', () => {
    expect(compactProviderEvidenceBytes(row)).toBe(508)
    expect(
      compactProviderEvidenceBytes({
        ...row,
        safeResult: {
          code: 'LEGACY_REQUEST_UNKNOWN',
          legacyAttemptsStarted: 2147483647,
          retryClockSupported: false,
        },
      })
    ).toBe(512)
    // The contract counts the fixed-field representation, not JSON or physical PG storage.
    expect(
      Buffer.byteLength(
        JSON.stringify(row, (_, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value
        )
      )
    ).toBeGreaterThan(512)
  })

  it('refuses unsupported content before any compaction rather than silently dropping it', () => {
    for (const changes of [
      { jobName: 'é'.repeat(64) },
      { jobId: 'x'.repeat(129) },
      { requestDigest: 'x'.repeat(64) },
      { safeResult: { providerResponse: 'unbounded' } },
      { revision: 2147483648 },
      { disposition: 'invented' },
    ])
      expect(() => compactProviderEvidenceBytes({ ...row, ...changes })).toThrow(
        'CONTENT_UNSUPPORTED'
      )
  })
})
