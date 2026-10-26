import type { BackgroundEffectEvidence } from '../../generated/prisma/client'

import { assertConservativeAdmission, conservativeDelay } from './conservative-evidence'

const clean = {
  policyVersion: 2,
  recipeVersion: 2,
  certainty: 'none',
  unresolvedCount: 0,
  outcomeRecorded: true,
  activeAttemptId: null,
  cooldownSupported: true,
} as BackgroundEffectEvidence

describe('Conservative effect policy', () => {
  it('admits authoritative aggregate none without a vendor clock or window', () => {
    expect(() => assertConservativeAdmission(clean)).not.toThrow()
  })
  it.each([
    [{ ...clean, certainty: 'unknown' }, 'EFFECT_UNKNOWN'],
    [{ ...clean, unresolvedCount: 1 }, 'EFFECT_UNKNOWN'],
    [{ ...clean, outcomeRecorded: false }, 'OUTCOME_UNRECORDED'],
    [{ ...clean, activeAttemptId: 'old' }, 'OUTCOME_UNRECORDED'],
    [{ ...clean, recipeVersion: null }, 'VERSION_UNSUPPORTED'],
    [{ ...clean, policyVersion: 1 }, 'VERSION_UNSUPPORTED'],
    [{ ...clean, cooldownSupported: false }, 'CONTENT_UNSUPPORTED'],
  ])('refuses unsafe evidence %#', (row, reason) => {
    expect(() => assertConservativeAdmission(row)).toThrow(reason)
  })
  it('unknown wins over an unsupported delay and cannot become none', () => {
    expect(() =>
      assertConservativeAdmission({ ...clean, certainty: 'unknown', cooldownSupported: false })
    ).toThrow('EFFECT_UNKNOWN')
  })
  it('preserves ordinary backoff and a longer reviewed duration', () => {
    expect(conservativeDelay(1)).toEqual({ delay: 1000, supported: true })
    expect(conservativeDelay(3)).toEqual({ delay: 4000, supported: true })
    expect(conservativeDelay(1, { kind: 'duration', milliseconds: 0 }).delay).toBe(1000)
    expect(conservativeDelay(1, { kind: 'duration', milliseconds: 86400000 })).toEqual({
      delay: 86400000,
      supported: true,
    })
  })
  it.each([
    { kind: 'absolute', timestamp: 100000 },
    { kind: 'unsupported' },
    { kind: 'duration', milliseconds: 86400001 },
  ] as const)('does not treat unsupported present input as absent %#', (input) => {
    expect(conservativeDelay(1, input).supported).toBe(false)
  })
})
