import { IntegrationErrorCode } from '@amcore/shared'

import { EMAIL_TEST_POLICY } from './email-test.policy.js'
import { EmailTestProbe } from './email-test.probe.js'
import type { StoredAttempt } from './email-test.view.js'

const ATTEMPT = 'A'.repeat(22)
const KEY = 'sk-secret-key-value'
const POLICY = {
  deadlineMs: EMAIL_TEST_POLICY.deadlineMs,
  operatorCooldownSeconds: EMAIL_TEST_POLICY.operatorCooldownSeconds,
  platformPerHour: EMAIL_TEST_POLICY.platformPerHour,
  leaseSeconds: EMAIL_TEST_POLICY.leaseSeconds,
}

function stored(over: Partial<StoredAttempt> = {}): StoredAttempt {
  return {
    actorId: 'u1',
    recipientToken: 'token',
    scopeWitness: 'witness',
    provider: 'resend',
    state: 'settled',
    outcome: 'accepted',
    class: '',
    reservedAt: 1_000,
    sentAt: 1_100,
    deadlineAt: 11_100,
    settledAt: 1_900,
    ...over,
  }
}

function build(overrides: { mode?: 'resend' | 'mock'; env?: string; verified?: boolean } = {}) {
  const store = {
    prepare: jest.fn().mockResolvedValue({ attemptId: ATTEMPT, expiresAt: 5_000_000 }),
    reserve: jest.fn().mockResolvedValue({ kind: 'reserved', now: 1_000 }),
    markSending: jest.fn().mockResolvedValue(true),
    failBeforeSend: jest.fn().mockResolvedValue(undefined),
    settle: jest
      .fn()
      .mockImplementation((_id: string, _lease: string, outcome: string, probeClass: string) =>
        Promise.resolve({ outcome, class: probeClass })
      ),
    readAttempt: jest.fn().mockResolvedValue(stored()),
    readLast: jest.fn().mockResolvedValue(null),
    readActorAttempt: jest.fn().mockResolvedValue(null),
    cooldownRemainingMs: jest.fn().mockResolvedValue(0),
    leaseHeld: jest.fn().mockResolvedValue(false),
    now: jest.fn().mockResolvedValue(2_000),
  }
  const provider = {
    sendPrepared: jest.fn().mockResolvedValue({ success: true, id: 'prov-1' }),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const db = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.verified === false
            ? { email: 'op@example.com', emailVerified: false }
            : { email: 'op@example.com', emailVerified: true }
        ),
    },
  }
  const values: Record<string, string> = {
    EMAIL_PROVIDER: overrides.mode ?? 'resend',
    NODE_ENV: overrides.env ?? 'test',
    EMAIL_FROM: 'noreply@example.com',
    RESEND_API_KEY: KEY,
  }
  const env = { get: (key: string) => values[key] }
  const logger = { setContext: jest.fn(), warn: jest.fn() }
  const probe = new EmailTestProbe(
    store as never,
    env as never,
    provider as never,
    audit as never,
    db as never,
    logger as never
  )
  return { probe, store, provider, audit, db, values }
}

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('EmailTestProbe.prepare', () => {
  it('returns a masked recipient and never the address or token', async () => {
    const { probe } = build()
    const prepared = await probe.prepare('u1')
    expect(prepared.recipientHint).toBe('o***@example.com')
    expect(JSON.stringify(prepared)).not.toContain('op@example.com')
    expect(Object.keys(prepared).sort()).toEqual(['attemptId', 'expiresAt', 'recipientHint'])
  })

  it('refuses an operator without a verified address and mock email in production', async () => {
    await expect(build({ verified: false }).probe.prepare('u1')).rejects.toMatchObject({
      response: expect.anything(),
    })
    const unverified = build({ verified: false })
    await expect(unverified.probe.prepare('u1')).rejects.toThrow(
      IntegrationErrorCode.INTEGRATION_NO_VERIFIED_ADDRESS
    )
    const mock = build({ mode: 'mock', env: 'production' })
    await expect(mock.probe.prepare('u1')).rejects.toThrow(
      IntegrationErrorCode.INTEGRATION_MOCK_IN_PRODUCTION
    )
    expect(mock.store.prepare).not.toHaveBeenCalled()
  })
})

describe('EmailTestProbe.run', () => {
  it('audits strictly before sending, then marks, sends and settles in order', async () => {
    const { probe, store, provider, audit } = build()
    const calls: string[] = []
    audit.record.mockImplementation((entry: { action: string }) => {
      calls.push(entry.action)
      return Promise.resolve()
    })
    store.markSending.mockImplementation(() => {
      calls.push('mark')
      return Promise.resolve(true)
    })
    provider.sendPrepared.mockImplementation(() => {
      calls.push('send')
      return Promise.resolve({ success: true, id: 'prov-1' })
    })
    store.settle.mockImplementation(() => {
      calls.push('settle')
      return Promise.resolve({ outcome: 'accepted', class: '' })
    })
    const receipt = await probe.run('u1', ATTEMPT, POLICY)
    expect(calls).toEqual([
      'integration.email_test_requested',
      'mark',
      'send',
      'settle',
      'integration.email_test_settled',
    ])
    expect(audit.record.mock.calls[0]?.[1]).toEqual({ failOpen: false })
    expect(store.settle).toHaveBeenCalledWith(ATTEMPT, expect.any(String), 'accepted', '')
    expect(receipt.outcome).toBe('accepted')
  })

  it('sends a fixed message to the stored address with the attempt as idempotency key', async () => {
    const { probe, provider } = build()
    await probe.run('u1', ATTEMPT, POLICY)
    const [body, key] = provider.sendPrepared.mock.calls[0] as [string, string]
    const parsed = JSON.parse(body) as { to: string[]; from: string }
    expect(parsed.to).toEqual(['op@example.com'])
    expect(parsed.from).toBe('noreply@example.com')
    expect(key).toContain(ATTEMPT)
  })

  it('does not send when the audit write fails, and closes the reservation as not started', async () => {
    const { probe, store, provider, audit } = build()
    audit.record.mockRejectedValueOnce(new Error('db down'))
    await expect(probe.run('u1', ATTEMPT, POLICY)).rejects.toThrow(
      IntegrationErrorCode.INTEGRATION_PROBE_UNAVAILABLE
    )
    expect(provider.sendPrepared).not.toHaveBeenCalled()
    expect(store.markSending).not.toHaveBeenCalled()
    expect(store.failBeforeSend).toHaveBeenCalledWith(ATTEMPT, expect.any(String), 'audit_failed')
  })

  it('does not send when the lease was lost before MARK_SENDING', async () => {
    const { probe, store, provider } = build()
    store.markSending.mockResolvedValue(false)
    await probe.run('u1', ATTEMPT, POLICY)
    expect(provider.sendPrepared).not.toHaveBeenCalled()
    expect(store.failBeforeSend).toHaveBeenCalledWith(ATTEMPT, expect.any(String), 'lease_lost')
  })

  it('does not call the transport after a process pause around MARK_SENDING', async () => {
    const { probe, store, provider } = build()
    const clock = jest.spyOn(performance, 'now')
    clock.mockReturnValueOnce(0) // t0, taken before the command
    clock.mockReturnValue(EMAIL_TEST_POLICY.precheckMs + 1) // the reply is processed after a pause
    await probe.run('u1', ATTEMPT, POLICY)
    expect(provider.sendPrepared).not.toHaveBeenCalled()
    expect(store.failBeforeSend).toHaveBeenCalledWith(ATTEMPT, expect.any(String), 'precheck')
    expect(store.settle).not.toHaveBeenCalled()
  })

  it('refuses before any audit or send when Redis admission is unavailable', async () => {
    const { probe, store, provider, audit } = build()
    store.reserve.mockRejectedValue(new Error(IntegrationErrorCode.INTEGRATION_PROBE_UNAVAILABLE))
    await expect(probe.run('u1', ATTEMPT, POLICY)).rejects.toThrow()
    expect(audit.record).not.toHaveBeenCalled()
    expect(provider.sendPrepared).not.toHaveBeenCalled()
  })

  it('maps an admission refusal to its status and Retry-After', async () => {
    const { probe, store } = build()
    store.reserve.mockResolvedValue({
      kind: 'refused',
      code: IntegrationErrorCode.INTEGRATION_PROBE_COOLDOWN,
      retryAfterSeconds: 42,
    })
    await expect(probe.run('u1', ATTEMPT, POLICY)).rejects.toMatchObject({
      status: 429,
      details: { retryAfterSeconds: 42 },
    })
  })

  it('returns the stored receipt of a replay without auditing or sending', async () => {
    const { probe, store, provider, audit } = build()
    store.reserve.mockResolvedValue({
      kind: 'replay',
      attempt: stored({ provider: 'mock', outcome: 'simulated' }),
    })
    const receipt = await probe.run('u1', ATTEMPT, POLICY)
    expect(receipt).toMatchObject({ outcome: 'simulated', provider: 'mock' })
    expect(audit.record).not.toHaveBeenCalled()
    expect(provider.sendPrepared).not.toHaveBeenCalled()
    expect(store.markSending).not.toHaveBeenCalled()
  })

  it('publishes unknown at the deadline for a transport that ignores abort, and holds nothing back', async () => {
    jest.useFakeTimers()
    const { probe, store, provider } = build()
    let finishLate: (value: unknown) => void = () => undefined
    provider.sendPrepared.mockImplementation(() => new Promise((resolve) => (finishLate = resolve)))
    const pending = probe.run('u1', ATTEMPT, POLICY)
    await jest.advanceTimersByTimeAsync(EMAIL_TEST_POLICY.deadlineMs + 10)
    await pending
    expect(store.settle).toHaveBeenCalledWith(ATTEMPT, expect.any(String), 'unknown', 'deadline')
    finishLate({ success: true, id: 'too-late' })
    await jest.advanceTimersByTimeAsync(1)
    expect(store.settle).toHaveBeenCalledTimes(1)
  })

  it('treats a thrown transport error as unknown', async () => {
    const { probe, store, provider } = build()
    provider.sendPrepared.mockRejectedValue(new Error('socket hang up'))
    await probe.run('u1', ATTEMPT, POLICY)
    expect(store.settle).toHaveBeenCalledWith(ATTEMPT, expect.any(String), 'unknown', '')
  })

  it('keeps provider text and the key out of everything it audits or settles', async () => {
    const { probe, store, provider, audit } = build()
    provider.sendPrepared.mockResolvedValue({
      success: false,
      id: '',
      error: `invalid_api_key ${KEY}`,
    })
    await probe.run('u1', ATTEMPT, POLICY)
    const seen = JSON.stringify([audit.record.mock.calls, store.settle.mock.calls])
    expect(seen).not.toContain(KEY)
    expect(seen).not.toContain('op@example.com')
  })
})

describe('EmailTestProbe witness and evidence', () => {
  it('changes with the key and sender but is never part of a receipt', async () => {
    const { probe, values } = build()
    const before = probe.witness()
    values.RESEND_API_KEY = 'another-key'
    expect(probe.witness()).not.toBe(before)
    values.EMAIL_FROM = 'other@example.com'
    expect(probe.witness()).not.toContain('another-key')
  })

  it('does not leak the witness digest through the receipt of its own attempt', async () => {
    const { probe, store } = build()
    const digest = probe.witness()
    store.readAttempt.mockResolvedValue(stored({ scopeWitness: digest }))
    const receipt = await probe.receiptFor('u1', ATTEMPT)
    expect(JSON.stringify(receipt)).not.toContain(digest)
  })

  it('answers 404 for another operator’s attempt', async () => {
    const { probe, store } = build()
    store.readAttempt.mockResolvedValue(stored({ actorId: 'someone-else' }))
    await expect(probe.receiptFor('u1', ATTEMPT)).rejects.toMatchObject({ status: 404 })
  })
})

describe('EmailTestProbe.action', () => {
  it('names why the test is unavailable and when the cooldown ends', async () => {
    const cooling = build()
    cooling.store.cooldownRemainingMs.mockResolvedValue(30_500)
    expect(await cooling.probe.action('u1')).toMatchObject({
      available: false,
      unavailableReason: 'cooldown',
      cooldownRemainingSeconds: 31,
    })
    expect((await build({ verified: false }).probe.action('u1')).unavailableReason).toBe(
      'no_verified_address'
    )
    expect(
      (await build({ mode: 'mock', env: 'production' }).probe.action('u1')).unavailableReason
    ).toBe('mock_in_production')
    const busy = build()
    busy.store.leaseHeld.mockResolvedValue(true)
    expect((await busy.probe.action('u1')).unavailableReason).toBe('busy')
  })

  it('exposes only an own attempt id', async () => {
    const own = build()
    own.store.readActorAttempt.mockResolvedValue(ATTEMPT)
    expect((await own.probe.action('u1')).ownAttemptId).toBe(ATTEMPT)
    const foreign = build()
    foreign.store.readActorAttempt.mockResolvedValue(ATTEMPT)
    foreign.store.readAttempt.mockResolvedValue(stored({ actorId: 'other' }))
    expect((await foreign.probe.action('u1')).ownAttemptId).toBeNull()
  })
})

describe('after the transport was called (C1)', () => {
  it('answers with an in-progress receipt, never a refusal, when the stored result cannot be read', async () => {
    const { probe, store, provider } = build()
    store.readAttempt.mockRejectedValue(
      new Error(IntegrationErrorCode.INTEGRATION_PROBE_UNAVAILABLE)
    )
    const receipt = await probe.run('u1', ATTEMPT, POLICY)
    expect(provider.sendPrepared).toHaveBeenCalledTimes(1)
    expect(receipt).toMatchObject({ attemptId: ATTEMPT, outcome: 'in_progress', state: 'sending' })
    expect(JSON.stringify(receipt)).not.toContain('op@example.com')
  })

  it('answers a replay from the stored attempt even when the clock cannot be read', async () => {
    const { probe, store, provider } = build()
    store.reserve.mockResolvedValue({ kind: 'replay', attempt: stored() })
    store.now.mockRejectedValue(new Error('redis down'))
    const receipt = await probe.run('u1', ATTEMPT, POLICY)
    expect(receipt).toMatchObject({ outcome: 'accepted', state: 'settled' })
    expect(provider.sendPrepared).not.toHaveBeenCalled()
  })
})

describe('local capacity of a transport that ignores abort (C2)', () => {
  it('holds this process’s slot after the logical deadline and frees it when the call ends', async () => {
    jest.useFakeTimers()
    const { probe, store, provider } = build()
    let finishLate: (value: unknown) => void = () => undefined
    provider.sendPrepared.mockImplementationOnce(
      () => new Promise((resolve) => (finishLate = resolve))
    )
    const first = probe.run('u1', 'A'.repeat(22), POLICY)
    await jest.advanceTimersByTimeAsync(POLICY.deadlineMs + 10)
    await first
    expect(store.settle).toHaveBeenCalledWith(
      'A'.repeat(22),
      expect.any(String),
      'unknown',
      'deadline'
    )

    // The shared lease is already released, but the earlier transport call is still open here.
    await expect(probe.run('u2', 'B'.repeat(22), POLICY)).rejects.toMatchObject({ status: 429 })
    expect(provider.sendPrepared).toHaveBeenCalledTimes(1)
    expect(store.failBeforeSend).toHaveBeenCalledWith('B'.repeat(22), expect.any(String), 'busy')

    finishLate({ success: true, id: 'late' })
    await jest.advanceTimersByTimeAsync(1)
    await probe.run('u3', 'C'.repeat(22), POLICY)
    expect(provider.sendPrepared).toHaveBeenCalledTimes(2)
  })
})

describe('the registered policy drives the execution (C3)', () => {
  it('passes the registered policy to admission and uses its deadline', async () => {
    jest.useFakeTimers()
    const { probe, store, provider } = build()
    const strict = {
      ...POLICY,
      deadlineMs: 2_000,
      operatorCooldownSeconds: 120,
      platformPerHour: 3,
    }
    provider.sendPrepared.mockImplementation(() => new Promise(() => undefined))
    const pending = probe.run('u1', ATTEMPT, strict)
    await jest.advanceTimersByTimeAsync(1_999)
    expect(store.settle).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(20)
    await pending
    expect(store.reserve).toHaveBeenCalledWith(expect.objectContaining({ policy: strict }))
    expect(store.settle).toHaveBeenCalledWith(ATTEMPT, expect.any(String), 'unknown', 'deadline')
  })
})

describe('the audit repeats only what the server stored (C5)', () => {
  const settledAudit = (audit: { record: jest.Mock }) =>
    audit.record.mock.calls.find(
      ([entry]) => (entry as { action: string }).action === 'integration.email_test_settled'
    )?.[0] as { metadata: Record<string, string> } | undefined

  it('records a late result as the unknown the server kept', async () => {
    const { probe, store, audit } = build()
    store.settle.mockResolvedValue({ outcome: 'unknown', class: 'deadline' })
    await probe.run('u1', ATTEMPT, POLICY)
    expect(settledAudit(audit)?.metadata).toMatchObject({ outcome: 'unknown', class: 'deadline' })
  })

  it('records an unknown stored result when the settle itself failed', async () => {
    const { probe, store, audit } = build()
    store.settle.mockRejectedValue(new Error('redis down'))
    await probe.run('u1', ATTEMPT, POLICY)
    expect(settledAudit(audit)?.metadata).toMatchObject({
      outcome: 'unknown',
      class: 'settle_failed',
    })
  })

  it('writes no finished record when the attempt was already settled', async () => {
    const { probe, store, audit } = build()
    store.settle.mockResolvedValue(null)
    await probe.run('u1', ATTEMPT, POLICY)
    expect(settledAudit(audit)).toBeUndefined()
  })
})
