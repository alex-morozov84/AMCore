import { EMAIL_TEST_POLICY } from './email-test.policy.js'
import {
  deriveStatus,
  lastToEvidence,
  parseAttempt,
  parseLast,
  type StoredLast,
  toReceipt,
} from './email-test.view.js'

const BASE: StoredLast = {
  attemptId: 'A'.repeat(22),
  scopeWitness: 'w1',
  provider: 'resend',
  state: 'settled',
  outcome: 'accepted',
  class: '',
  reservedAt: 1_000,
  sentAt: 1_100,
  deadlineAt: 11_100,
  settledAt: 1_900,
}

describe('deriveStatus', () => {
  it('reads a reservation that never started as "did not start" after the limit', () => {
    const reserved = { ...BASE, state: 'reserved' as const, outcome: '', sentAt: 0, deadlineAt: 0 }
    expect(deriveStatus(reserved, 1_000 + EMAIL_TEST_POLICY.abandonedAfterMs).outcome).toBe(
      'in_progress'
    )
    expect(deriveStatus(reserved, 1_001 + EMAIL_TEST_POLICY.abandonedAfterMs)).toMatchObject({
      outcome: 'not_started',
      class: 'abandoned',
      terminal: true,
    })
  })

  it('reads a send without a settle as unknown after its deadline plus grace', () => {
    const sending = { ...BASE, state: 'sending' as const, outcome: '', settledAt: 0 }
    const limit = BASE.deadlineAt + EMAIL_TEST_POLICY.unknownGraceMs
    expect(deriveStatus(sending, limit).terminal).toBe(false)
    expect(deriveStatus(sending, limit + 1)).toMatchObject({
      outcome: 'unknown',
      class: 'deadline',
      terminal: true,
    })
  })
})

describe('lastToEvidence', () => {
  const now = BASE.settledAt + 1_000

  it('has no evidence without a stored observation', () => {
    expect(lastToEvidence(null, 'w1', now)).toMatchObject({ result: 'none', checkedAt: null })
  })

  it('hides evidence recorded for other settings', () => {
    expect(lastToEvidence(BASE, 'w2', now)).toMatchObject({
      result: 'none',
      failure: 'configuration_changed',
    })
  })

  it('keeps a failed result visible when it becomes stale', () => {
    const failed = { ...BASE, outcome: 'refused', class: 'auth' }
    const old = failed.settledAt + EMAIL_TEST_POLICY.staleAfterSeconds * 1000 + 1
    expect(lastToEvidence(failed, 'w1', old)).toMatchObject({
      result: 'failed',
      freshness: 'stale',
      failure: 'auth',
    })
  })

  it('never reports the mock provider as working', () => {
    expect(
      lastToEvidence({ ...BASE, outcome: 'simulated', provider: 'mock' }, 'w1', now).result
    ).toBe('simulated')
  })

  it('does not turn an unfinished or abandoned attempt into a result', () => {
    const sending = { ...BASE, state: 'sending' as const, outcome: '', settledAt: 0 }
    expect(lastToEvidence(sending, 'w1', BASE.sentAt + 10).result).toBe('none')
    const notStarted = { ...BASE, outcome: 'not_started', class: 'audit_failed' }
    expect(lastToEvidence(notStarted, 'w1', now)).toMatchObject({
      result: 'none',
      failure: 'audit_failed',
    })
  })

  it('judges freshness against Redis time, not an API clock', () => {
    expect(lastToEvidence(BASE, 'w1', BASE.settledAt).freshness).toBe('fresh')
  })
})

describe('toReceipt', () => {
  it('maps public fields only and keeps the stored provider', () => {
    const attempt = parseAttempt({
      actorId: 'u1',
      recipientToken: 'secret-token',
      scopeWitness: 'digest',
      provider: 'resend',
      state: 'settled',
      outcome: 'accepted',
      class: '',
      reservedAt: '1000',
      sentAt: '1100',
      deadlineAt: '11100',
      settledAt: '1900',
    })!
    const receipt = toReceipt('A'.repeat(22), attempt, 2_000)
    expect(Object.keys(receipt).sort()).toEqual([
      'attemptId',
      'class',
      'outcome',
      'provider',
      'reservedAt',
      'settledAt',
      'state',
    ])
    expect(JSON.stringify(receipt)).not.toContain('digest')
    expect(JSON.stringify(receipt)).not.toContain('secret-token')
    expect(JSON.stringify(receipt)).not.toContain('u1')
  })

  it('reads the latest observation from its own copy of the times', () => {
    const last = parseLast({ attemptId: 'B'.repeat(22), state: 'reserved', reservedAt: '10' })!
    expect(toReceipt(last.attemptId, last, 20).outcome).toBe('in_progress')
  })
})
