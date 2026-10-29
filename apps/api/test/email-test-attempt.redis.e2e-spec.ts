import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'

import { IntegrationErrorCode } from '@amcore/shared'

import { emailTestKeys } from '../src/core/admin/integrations/email-test/email-test.keys.js'
import { EMAIL_TEST_POLICY } from '../src/core/admin/integrations/email-test/email-test.policy.js'
import { EmailTestStore } from '../src/core/admin/integrations/email-test/email-test.store.js'
import type { AppRedisClient } from '../src/infrastructure/redis/index.js'

import { e2eContainerLabels } from './e2e-owned-containers'
import { appClientOptions } from './test-redis'

/** The Lua lifecycle of the operator email test against a real Redis 7. */
const policy = {
  deadlineMs: EMAIL_TEST_POLICY.deadlineMs,
  operatorCooldownSeconds: EMAIL_TEST_POLICY.operatorCooldownSeconds,
  platformPerHour: EMAIL_TEST_POLICY.platformPerHour,
  leaseSeconds: EMAIL_TEST_POLICY.leaseSeconds,
}

describe('email test attempt lifecycle (real Redis)', () => {
  let container: StartedRedisContainer
  let client: AppRedisClient
  let store: EmailTestStore
  let counter = 0

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
    client = createClient(appClientOptions(container.getConnectionUrl()))
    await client.connect()
    store = new EmailTestStore(client)
  }, 120_000)

  afterAll(async () => {
    await client?.quit()
    await container?.stop()
  })

  beforeEach(async () => {
    await client.flushAll()
    counter = 0
  })

  const token = (): string => `lease-${(counter += 1)}`
  const id = (label: string): string => label.padEnd(22, '_')

  async function reserved(actor: string, label: string, lease = token()) {
    await store.prepare(actor, id(label), 'recipient-token', 'witness')
    const result = await store.reserve({
      attemptId: id(label),
      actorId: actor,
      recipientToken: 'recipient-token',
      scopeWitness: 'witness',
      leaseToken: lease,
      provider: 'resend',
      policy,
    })
    return { result, lease }
  }

  it('runs prepare, reserve, mark sending and settle, and releases the lease', async () => {
    const { result, lease } = await reserved('u1', 'a')
    expect(result.kind).toBe('reserved')
    expect(await store.markSending(id('a'), lease)).toBe(true)
    await store.settle(id('a'), lease, 'accepted', '')
    expect(await store.readAttempt(id('a'))).toMatchObject({
      state: 'settled',
      outcome: 'accepted',
    })
    expect(await store.readLast()).toMatchObject({ attemptId: id('a'), outcome: 'accepted' })
    expect(await store.leaseHeld()).toBe(false)
    expect(await store.readActorAttempt('u1')).toBe(id('a'))
  })

  it('replays a stored attempt without touching limits, last or the actor pointer (A/B/A)', async () => {
    const a = await reserved('u1', 'a')
    await store.markSending(id('a'), a.lease)
    await store.settle(id('a'), a.lease, 'accepted', '')
    const b = await reserved('u2', 'b')
    await store.markSending(id('b'), b.lease)
    await store.settle(id('b'), b.lease, 'accepted', '')
    const quotaBefore = await client.hGetAll(emailTestKeys.quota)

    const again = await store.reserve({
      attemptId: id('a'),
      actorId: 'u1',
      recipientToken: 'recipient-token',
      scopeWitness: 'witness',
      leaseToken: token(),
      provider: 'resend',
      policy,
    })
    expect(again.kind).toBe('replay')
    expect(await store.readLast()).toMatchObject({ attemptId: id('b') })
    expect(await store.readActorAttempt('u1')).toBe(id('a'))
    expect(await client.hGetAll(emailTestKeys.quota)).toEqual(quotaBefore)
    expect(await store.leaseHeld()).toBe(false)
  })

  it('refuses another operator for an existing attempt and an unknown or consumed id', async () => {
    const a = await reserved('u1', 'a')
    await store.markSending(id('a'), a.lease)
    await store.settle(id('a'), a.lease, 'accepted', '')
    const foreign = await store.reserve({
      attemptId: id('a'),
      actorId: 'u2',
      recipientToken: 'recipient-token',
      scopeWitness: 'witness',
      leaseToken: token(),
      provider: 'resend',
      policy,
    })
    expect(foreign).toEqual({
      kind: 'refused',
      code: IntegrationErrorCode.INTEGRATION_ATTEMPT_MISMATCH,
    })
    const unknown = await store.reserve({
      attemptId: id('never'),
      actorId: 'u1',
      recipientToken: 'recipient-token',
      scopeWitness: 'witness',
      leaseToken: token(),
      provider: 'resend',
      policy,
    })
    expect(unknown).toMatchObject({ code: IntegrationErrorCode.INTEGRATION_ATTEMPT_EXPIRED })
  })

  it('does not resend after the attempt key is gone (server-issued ids)', async () => {
    const a = await reserved('u1', 'a')
    await store.markSending(id('a'), a.lease)
    await store.settle(id('a'), a.lease, 'accepted', '')
    await client.del(emailTestKeys.attempt(id('a')))
    await client.del(emailTestKeys.last)
    const retry = await store.reserve({
      attemptId: id('a'),
      actorId: 'u1',
      recipientToken: 'recipient-token',
      scopeWitness: 'witness',
      leaseToken: token(),
      provider: 'resend',
      policy,
    })
    expect(retry).toMatchObject({
      kind: 'refused',
      code: IntegrationErrorCode.INTEGRATION_ATTEMPT_EXPIRED,
    })
  })

  it('invalidates an earlier issue when a new one replaces it', async () => {
    await store.prepare('u1', id('first'), 'recipient-token', 'witness')
    await store.prepare('u1', id('second'), 'other-token', 'witness')
    const old = await store.reserve({
      attemptId: id('first'),
      actorId: 'u1',
      recipientToken: 'recipient-token',
      scopeWitness: 'witness',
      leaseToken: token(),
      provider: 'resend',
      policy,
    })
    expect(old).toMatchObject({
      kind: 'refused',
      code: IntegrationErrorCode.INTEGRATION_ATTEMPT_EXPIRED,
    })
  })

  it('refuses a changed recipient or changed settings', async () => {
    await store.prepare('u1', id('a'), 'recipient-token', 'witness')
    const changedRecipient = await store.reserve({
      attemptId: id('a'),
      actorId: 'u1',
      recipientToken: 'someone-else',
      scopeWitness: 'witness',
      leaseToken: token(),
      provider: 'resend',
      policy,
    })
    expect(changedRecipient).toMatchObject({
      code: IntegrationErrorCode.INTEGRATION_RECIPIENT_CHANGED,
    })
    const changedSettings = await store.reserve({
      attemptId: id('a'),
      actorId: 'u1',
      recipientToken: 'recipient-token',
      scopeWitness: 'new-witness',
      leaseToken: token(),
      provider: 'resend',
      policy,
    })
    expect(changedSettings).toMatchObject({ code: IntegrationErrorCode.INTEGRATION_CONFIG_CHANGED })
    expect(await client.exists(emailTestKeys.attempt(id('a')))).toBe(0)
  })

  it('enforces the operator cooldown and the single in-flight lease', async () => {
    const first = await reserved('u1', 'a')
    expect(first.result.kind).toBe('reserved')
    const busy = await reserved('u2', 'b')
    expect(busy.result).toMatchObject({ code: IntegrationErrorCode.INTEGRATION_PROBE_BUSY })
    await store.markSending(id('a'), first.lease)
    await store.settle(id('a'), first.lease, 'accepted', '')
    const cooling = await reserved('u1', 'c')
    expect(cooling.result).toMatchObject({ code: IntegrationErrorCode.INTEGRATION_PROBE_COOLDOWN })
    expect(await store.cooldownRemainingMs('u1')).toBeGreaterThan(0)
  })

  it('caps the platform per hour and resets on a new hour bucket', async () => {
    for (let index = 0; index < EMAIL_TEST_POLICY.platformPerHour; index += 1) {
      const attempt = await reserved(`u${index}`, `a${index}`)
      expect(attempt.result.kind).toBe('reserved')
      await store.markSending(id(`a${index}`), attempt.lease)
      await store.settle(id(`a${index}`), attempt.lease, 'accepted', '')
    }
    const over = await reserved('other', 'over')
    expect(over.result).toMatchObject({ code: IntegrationErrorCode.INTEGRATION_PROBE_LIMIT })
    await client.hSet(emailTestKeys.quota, 'bucket', '1')
    const next = await reserved('other2', 'next')
    expect(next.result.kind).toBe('reserved')
  })

  it('refuses MARK_SENDING without the current lease token', async () => {
    const a = await reserved('u1', 'a')
    expect(await store.markSending(id('a'), 'wrong-token')).toBe(false)
    expect(await store.markSending(id('a'), a.lease)).toBe(true)
    expect(await store.markSending(id('a'), a.lease)).toBe(false)
  })

  it('stores a result that arrives after the deadline as unknown', async () => {
    const a = await reserved('u1', 'a')
    await store.markSending(id('a'), a.lease)
    await client.hSet(emailTestKeys.attempt(id('a')), 'deadlineAt', '1')
    await store.settle(id('a'), a.lease, 'accepted', '')
    expect(await store.readAttempt(id('a'))).toMatchObject({
      outcome: 'unknown',
      class: 'deadline',
    })
    expect(await store.readLast()).toMatchObject({ outcome: 'unknown', class: 'deadline' })
  })

  it('keeps the newer observation when an older attempt settles late', async () => {
    const a = await reserved('u1', 'a')
    await store.markSending(id('a'), a.lease)
    await client.del(emailTestKeys.lease) // lease expired while A is still sending
    const b = await reserved('u2', 'b')
    expect(b.result.kind).toBe('reserved')
    await store.settle(id('a'), a.lease, 'accepted', '')
    expect(await store.readAttempt(id('a'))).toMatchObject({
      state: 'settled',
      outcome: 'accepted',
    })
    expect(await store.readLast()).toMatchObject({ attemptId: id('b'), state: 'reserved' })
  })

  it('never recreates a missing last when an attempt settles', async () => {
    const c = await reserved('u3', 'c')
    expect(c.result.kind).toBe('reserved')
    expect(await store.markSending(id('c'), c.lease)).toBe(true)
    await client.del(emailTestKeys.last)
    await store.settle(id('c'), c.lease, 'accepted', '')
    expect(await store.readAttempt(id('c'))).toMatchObject({
      state: 'settled',
      outcome: 'accepted',
    })
    expect(await store.readLast()).toBeNull()
  })

  it('reports the result the server stored, which a late result does not change', async () => {
    const a = await reserved('u1', 'a')
    await store.markSending(id('a'), a.lease)
    expect(await store.settle(id('a'), a.lease, 'accepted', '')).toEqual({
      outcome: 'accepted',
      class: '',
    })
    const b = await reserved('u2', 'b')
    await store.markSending(id('b'), b.lease)
    await client.hSet(emailTestKeys.attempt(id('b')), 'deadlineAt', '1')
    expect(await store.settle(id('b'), b.lease, 'accepted', '')).toEqual({
      outcome: 'unknown',
      class: 'deadline',
    })
    expect(await store.settle(id('b'), b.lease, 'refused', 'auth')).toBeNull()
  })

  it('applies the registered policy to admission and to the stored deadline', async () => {
    const strict = {
      ...policy,
      operatorCooldownSeconds: 120,
      platformPerHour: 1,
      deadlineMs: 4_000,
    }
    await store.prepare('u1', id('a'), 'recipient-token', 'witness')
    const first = await store.reserve({
      attemptId: id('a'),
      actorId: 'u1',
      recipientToken: 'recipient-token',
      scopeWitness: 'witness',
      leaseToken: token(),
      provider: 'resend',
      policy: strict,
    })
    expect(first.kind).toBe('reserved')
    expect(await store.cooldownRemainingMs('u1')).toBeGreaterThan(110_000)
    expect(await client.hGet(emailTestKeys.attempt(id('a')), 'deadlineMs')).toBe('4000')
    await client.del(emailTestKeys.lease)
    await store.prepare('u2', id('b'), 'recipient-token', 'witness')
    const second = await store.reserve({
      attemptId: id('b'),
      actorId: 'u2',
      recipientToken: 'recipient-token',
      scopeWitness: 'witness',
      leaseToken: token(),
      provider: 'resend',
      policy: strict,
    })
    expect(second).toMatchObject({ code: IntegrationErrorCode.INTEGRATION_PROBE_LIMIT })
  })

  it('returns the same live issue while token and settings are unchanged, and replaces it otherwise', async () => {
    const first = await store.prepare('u1', id('one'), 'recipient-token', 'witness')
    const again = await store.prepare('u1', id('two'), 'recipient-token', 'witness')
    expect(again.attemptId).toBe(first.attemptId)
    const changed = await store.prepare('u1', id('three'), 'other-token', 'witness')
    expect(changed.attemptId).toBe(id('three'))
  })

  it('closes a reservation that never started and releases only its own lease', async () => {
    const a = await reserved('u1', 'a')
    await store.failBeforeSend(id('a'), 'someone-elses-token', 'audit_failed')
    expect(await store.leaseHeld()).toBe(true) // a foreign token never releases the lease
    expect(await store.readAttempt(id('a'))).toMatchObject({
      state: 'settled',
      outcome: 'not_started',
      class: 'audit_failed',
    })
    await store.failBeforeSend(id('a'), a.lease, 'audit_failed') // the owner's token releases it
    expect(await store.leaseHeld()).toBe(false)
    expect(a.result.kind).toBe('reserved')
  })

  it('treats a second terminal transition as a no-op', async () => {
    const a = await reserved('u1', 'a')
    await store.markSending(id('a'), a.lease)
    await store.settle(id('a'), a.lease, 'refused', 'auth')
    await store.settle(id('a'), a.lease, 'accepted', '')
    expect(await store.readAttempt(id('a'))).toMatchObject({ outcome: 'refused', class: 'auth' })
  })

  it('measures time with Redis TIME', async () => {
    const before = Date.now()
    const now = await store.now()
    expect(Math.abs(now - before)).toBeLessThan(5_000)
  })
})
