import { randomUUID } from 'node:crypto'

import type { InvitationAdmission } from '@amcore/shared'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { publishInvitationAuth, reserveInvitationAuth } from './invitation-auth-transition'
import {
  attachInvitationBootstrap,
  readInvitationBootstrap,
  saveInvitationBootstrap,
} from './invitation-bootstrap-store'
import { admitInvitationFlow, newInvitationOwner } from './invitation-flow-authority'
import {
  invitationOwnerHash,
  invitationOwnerKey,
  invitationOwnerStore,
} from './invitation-owner-store'
import {
  discardInvitationSession,
  publishInvitationSession,
  stageInvitationSession,
} from './invitation-session-publication'
import type { InvitationOwnerRecord } from './invitation-vault-record'
import { getWebRedisClient } from './redis-client'
import type { VaultRecord } from './session-vault.types'
import { redisVaultStore } from './session-vault-store'

vi.mock('server-only', () => ({}))
let container: StartedRedisContainer | undefined
beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start()
  process.env.REDIS_URL = container.getConnectionUrl()
}, 60000)
afterAll(async () => {
  if (container) await (await getWebRedisClient()).close()
  await container?.stop()
})

function owner(): InvitationOwnerRecord {
  return {
    version: 1,
    origin: 'https://app.example.test',
    expiresAt: Date.now() + 60000,
    epoch: 0,
    sessionBinding: null,
    admissionsStartedAt: Date.now(),
    admissions: 0,
    flows: [],
    pendingOAuthAttemptId: null,
  }
}

async function stagedPublication() {
  const now = Date.now()
  const admitted = admitInvitationFlow(
    newInvitationOwner('https://app.example.test', null, now),
    {
      credential: 'c'.repeat(43),
      expiresAt: new Date(now + 1800000).toISOString(),
      intent: { expectedInviteId: 'example-invitation', expectedGeneration: 1 },
    },
    'en',
    null,
    now
  )
  const reservation = reserveInvitationAuth(
    admitted.owner,
    admitted.flow.binding,
    null,
    'login',
    null,
    now
  )
  const hash = invitationOwnerHash(randomUUID())
  await invitationOwnerStore.create(hash, reservation.owner)
  const entry: VaultRecord = {
    accessToken: '<test-access>',
    refreshToken: '<test-refresh>',
    accessTokenExpiresAt: now + 900000,
    userSnapshot: { id: 'example-user' } as VaultRecord['userSnapshot'],
  }
  const deadline = now + 60000
  const sessionId = await stageInvitationSession({
    ownerHash: hash,
    flowId: reservation.flow.binding.flowId,
    attemptId: reservation.attempt.id,
    deadline,
    entry,
  })
  const next = publishInvitationAuth(
    reservation.owner,
    reservation.flow.binding.flowId,
    reservation.attempt.id,
    reservation.attempt.fence,
    null,
    { binding: 'a'.repeat(64), vaultId: sessionId, backendId: 'example-backend', deadline },
    now
  )
  return { hash, next, sessionId, entry, initial: reservation.owner }
}

describe('invitation owner atomic storage on real Redis', () => {
  it('bootstrap requires the current cookie owner and consumes its selector only with the owner CAS', async () => {
    const now = Date.now()
    const initial = newInvitationOwner('https://app.example.test', null, now)
    const hash = invitationOwnerHash(randomUUID())
    const otherHash = invitationOwnerHash(randomUUID())
    await invitationOwnerStore.create(hash, initial)
    await invitationOwnerStore.create(otherHash, initial)
    const admission: InvitationAdmission = {
      credential: 'c'.repeat(43),
      expiresAt: new Date(now + 1800000).toISOString(),
      intent: { expectedInviteId: 'example-invitation', expectedGeneration: 1 },
    }
    const id = await saveInvitationBootstrap(hash, initial.origin, 'en', admission, now)
    expect(await readInvitationBootstrap(id, otherHash, initial.origin)).toBeNull()
    expect(await readInvitationBootstrap(id, hash, 'https://other.example.test')).toBeNull()
    expect(await readInvitationBootstrap(id, hash, initial.origin)).toMatchObject({ admission })
    const attached = admitInvitationFlow(initial, admission, 'en', null, now)
    expect(
      await attachInvitationBootstrap(
        id,
        otherHash,
        1,
        attached.owner,
        attached.flow.binding.flowId
      )
    ).toBe(false)
    expect(
      await attachInvitationBootstrap(id, hash, 2, attached.owner, attached.flow.binding.flowId)
    ).toBe(false)
    expect(await readInvitationBootstrap(id, hash, initial.origin)).not.toBeNull()
    expect(
      await attachInvitationBootstrap(id, hash, 1, attached.owner, attached.flow.binding.flowId)
    ).toBe(true)
    expect(await readInvitationBootstrap(id, hash, initial.origin)).toBeNull()
    expect(await invitationOwnerStore.get(hash, initial.origin)).toMatchObject({
      version: 2,
      admissions: 1,
    })
  })

  it('expired bootstrap staging cannot attach a flow', async () => {
    const now = Date.now()
    const initial = newInvitationOwner('https://app.example.test', null, now)
    const hash = invitationOwnerHash(randomUUID())
    await invitationOwnerStore.create(hash, initial)
    const admission: InvitationAdmission = {
      credential: 'c'.repeat(43),
      expiresAt: new Date(now + 1800000).toISOString(),
      intent: { expectedInviteId: 'example-invitation', expectedGeneration: 1 },
    }
    const id = await saveInvitationBootstrap(hash, initial.origin, 'en', admission, now - 61000)
    const attached = admitInvitationFlow(initial, admission, 'en', null, now)
    expect(await readInvitationBootstrap(id, hash, initial.origin)).toBeNull()
    expect(
      await attachInvitationBootstrap(id, hash, 1, attached.owner, attached.flow.binding.flowId)
    ).toBe(false)
  })
  it('publishes the staged session and unconfirmed handoff in one fenced transaction', async () => {
    const staged = await stagedPublication()
    expect(await redisVaultStore.get(staged.sessionId)).toBeNull()
    expect(await publishInvitationSession(staged.hash, 1, staged.next, staged.sessionId)).toBe(true)
    expect(await redisVaultStore.get(staged.sessionId)).toEqual({ ...staged.entry, version: 1 })
    expect(await invitationOwnerStore.get(staged.hash, staged.next.origin)).toMatchObject({
      version: 2,
      flows: [{ state: 'completing_signin', handoff: { confirmed: false } }],
    })
    expect(await publishInvitationSession(staged.hash, 1, staged.next, staged.sessionId)).toBe(
      false
    )
    await discardInvitationSession(staged.hash, staged.sessionId)
    expect(await redisVaultStore.get(staged.sessionId)).toEqual({ ...staged.entry, version: 1 })
  })

  it('leaves staged credentials inaccessible after a competing owner mutation', async () => {
    const staged = await stagedPublication()
    await invitationOwnerStore.compareAndSet(staged.hash, 1, { ...staged.initial, epoch: 1 })
    expect(await publishInvitationSession(staged.hash, 1, staged.next, staged.sessionId)).toBe(
      false
    )
    expect(await redisVaultStore.get(staged.sessionId)).toBeNull()
  })

  it('cannot publish staging belonging to another owner or a different handoff', async () => {
    const staged = await stagedPublication()
    const other = invitationOwnerHash(randomUUID())
    await invitationOwnerStore.create(other, staged.initial)
    expect(await publishInvitationSession(other, 1, staged.next, staged.sessionId)).toBe(false)
    const wrong = {
      ...staged.next,
      flows: staged.next.flows.map((flow) => ({
        ...flow,
        handoff: flow.handoff ? { ...flow.handoff, attemptId: 'x'.repeat(22) } : null,
      })),
    }
    expect(await publishInvitationSession(staged.hash, 1, wrong, staged.sessionId)).toBe(false)
    expect(await redisVaultStore.get(staged.sessionId)).toBeNull()
    expect(await invitationOwnerStore.get(staged.hash, staged.initial.origin)).toEqual(
      staged.initial
    )
    await discardInvitationSession(other, staged.sessionId)
    expect(await publishInvitationSession(staged.hash, 1, staged.next, staged.sessionId)).toBe(true)
  })

  it('discards only unpublished staging after a failed handoff', async () => {
    const staged = await stagedPublication()
    await discardInvitationSession(staged.hash, staged.sessionId)
    expect(await publishInvitationSession(staged.hash, 1, staged.next, staged.sessionId)).toBe(
      false
    )
    expect(await redisVaultStore.get(staged.sessionId)).toBeNull()
  })
  it('creates only once and binds reads to the canonical owner origin', async () => {
    const hash = invitationOwnerHash(randomUUID())
    const initial = owner()
    expect(await invitationOwnerStore.create(hash, initial)).toBe(true)
    expect(await invitationOwnerStore.create(hash, initial)).toBe(false)
    expect(await invitationOwnerStore.get(hash, initial.origin)).toEqual(initial)
    expect(await invitationOwnerStore.get(hash, 'https://other.example.test')).toBeNull()
  })

  it('permits exactly one concurrent write at the same owner version', async () => {
    const hash = invitationOwnerHash(randomUUID())
    const initial = owner()
    await invitationOwnerStore.create(hash, initial)
    const result = await Promise.all([
      invitationOwnerStore.compareAndSet(hash, 1, { ...initial, admissions: 1 }),
      invitationOwnerStore.compareAndSet(hash, 1, { ...initial, admissions: 2 }),
    ])
    expect(result.sort()).toEqual([false, true])
    expect(await invitationOwnerStore.get(hash, initial.origin)).toMatchObject({ version: 2 })
  })

  it('rejects stale resurrection, origin replacement and sliding owner expiry', async () => {
    const hash = invitationOwnerHash(randomUUID())
    const initial = owner()
    await invitationOwnerStore.create(hash, initial)
    expect(
      await invitationOwnerStore.compareAndSet(hash, 1, {
        ...initial,
        expiresAt: initial.expiresAt + 60000,
      })
    ).toBe(false)
    expect(
      await invitationOwnerStore.compareAndSet(hash, 1, {
        ...initial,
        origin: 'https://other.example.test',
      })
    ).toBe(false)
    expect(await invitationOwnerStore.compareAndSet(hash, 1, initial)).toBe(true)
    expect(await invitationOwnerStore.compareAndSet(hash, 1, initial)).toBe(false)
  })

  it('uses the original absolute expiration for every successful write', async () => {
    const hash = invitationOwnerHash(randomUUID())
    const initial = owner()
    await invitationOwnerStore.create(hash, initial)
    expect(await invitationOwnerStore.compareAndSet(hash, 1, { ...initial, epoch: 1 })).toBe(true)
    const redis = await getWebRedisClient()
    expect(await redis.sendCommand(['PEXPIRETIME', invitationOwnerKey(hash)])).toBe(
      initial.expiresAt
    )
    await redis.del(invitationOwnerKey(hash))
    expect(await invitationOwnerStore.compareAndSet(hash, 2, { ...initial, epoch: 2 })).toBe(false)
  })
})
