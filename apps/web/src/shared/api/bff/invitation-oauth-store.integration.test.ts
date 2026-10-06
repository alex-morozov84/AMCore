import { randomUUID } from 'node:crypto'

import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { publishInvitationAuth, reserveInvitationAuth } from './invitation-auth-transition'
import { admitInvitationFlow, newInvitationOwner } from './invitation-flow-authority'
import type { InvitationOAuthCarrier } from './invitation-oauth-carrier'
import {
  invitationOAuthCarrierKey,
  readInvitationOAuthCarrier,
  reserveInvitationOAuthCarrier,
  startInvitationOAuthCarrier,
} from './invitation-oauth-store'
import { invitationOwnerHash, invitationOwnerStore } from './invitation-owner-store'
import { publishInvitationSession, stageInvitationSession } from './invitation-session-publication'
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

async function reservation() {
  const now = Date.now()
  const initial = admitInvitationFlow(
    newInvitationOwner('https://app.example.test', null, now),
    {
      credential: 'c'.repeat(43),
      expiresAt: new Date(now + 1800000).toISOString(),
      intent: { expectedInviteId: 'example-invitation', expectedGeneration: 2 },
    },
    'en',
    null,
    now
  )
  const hash = invitationOwnerHash(randomUUID())
  await invitationOwnerStore.create(hash, initial.owner)
  const reserved = reserveInvitationAuth(
    initial.owner,
    initial.flow.binding,
    null,
    'oauth',
    'google',
    now
  )
  const carrier: InvitationOAuthCarrier = {
    attemptId: reserved.attempt.id,
    ownerHash: hash,
    origin: initial.owner.origin,
    flowId: initial.flow.binding.flowId,
    reservedRevision: reserved.attempt.reservedRevision,
    expectedSessionBinding: null,
    ownerEpoch: reserved.owner.epoch,
    provider: 'google',
    ...initial.flow.intent,
    fence: reserved.attempt.fence,
    createdAt: reserved.attempt.createdAt,
    expiresAt: reserved.attempt.expiresAt,
    status: 'reserved',
    ticketHash: null,
    backendSessionId: null,
  }
  return { now, initial, hash, reserved, carrier }
}

async function stagedOAuth() {
  const value = await reservation()
  const { carrier, hash, reserved } = value
  expect(await reserveInvitationOAuthCarrier(hash, 1, reserved.owner, carrier)).toBe(true)
  const started = {
    ...reserved.owner,
    flows: reserved.owner.flows.map((flow) => ({
      ...flow,
      attempt: flow.attempt ? { ...flow.attempt, started: true } : null,
    })),
  }
  expect(await startInvitationOAuthCarrier(hash, 2, started, carrier)).toBe(true)
  const entry: VaultRecord = {
    accessToken: '<test-access>',
    refreshToken: '<test-refresh>',
    accessTokenExpiresAt: Date.now() + 900000,
    userSnapshot: { id: 'example-user' } as VaultRecord['userSnapshot'],
  }
  const deadline = Date.now() + 60000
  const ticketHash = 'e'.repeat(64)
  const sessionId = await stageInvitationSession({
    ownerHash: hash,
    flowId: carrier.flowId,
    attemptId: carrier.attemptId,
    deadline,
    entry,
    oauth: {
      carrier: { ...carrier, status: 'started' },
      ticketHash,
      backendSessionId: 'example-backend',
    },
  })
  const next = publishInvitationAuth(
    started,
    carrier.flowId,
    carrier.attemptId,
    carrier.fence,
    null,
    { binding: 'a'.repeat(64), vaultId: sessionId, backendId: 'example-backend', deadline },
    Date.now()
  )
  next.flows[0]!.handoff!.ticketHash = ticketHash
  return { ...value, next, sessionId, ticketHash }
}

describe('invited OAuth atomic storage on real Redis', () => {
  it('reserves once and starts once without sliding absolute expiration', async () => {
    const { hash, reserved, carrier } = await reservation()
    expect(await reserveInvitationOAuthCarrier(hash, 1, reserved.owner, carrier)).toBe(true)
    expect(await reserveInvitationOAuthCarrier(hash, 1, reserved.owner, carrier)).toBe(false)
    const next = {
      ...reserved.owner,
      flows: reserved.owner.flows.map((flow) => ({
        ...flow,
        attempt: flow.attempt ? { ...flow.attempt, started: true } : null,
      })),
    }
    expect(await startInvitationOAuthCarrier(hash, 2, next, carrier)).toBe(true)
    expect(await startInvitationOAuthCarrier(hash, 3, next, carrier)).toBe(false)
    expect(await readInvitationOAuthCarrier(carrier.attemptId)).toMatchObject({
      status: 'started',
      expiresAt: carrier.expiresAt,
    })
  })

  it('consumes carrier, publishes journal and promotes session in the same transaction', async () => {
    const { hash, next, sessionId, carrier, ticketHash } = await stagedOAuth()
    expect(await redisVaultStore.get(sessionId)).toBeNull()
    expect(await publishInvitationSession(hash, 3, next, sessionId, carrier.attemptId)).toBe(true)
    expect(await redisVaultStore.get(sessionId)).not.toBeNull()
    expect(await readInvitationOAuthCarrier(carrier.attemptId)).toMatchObject({
      status: 'used',
      ticketHash,
      backendSessionId: 'example-backend',
    })
    expect(await invitationOwnerStore.get(hash, carrier.origin)).toMatchObject({
      version: 4,
      pendingOAuthAttemptId: null,
      flows: [{ state: 'completing_signin', handoff: { ticketHash, confirmed: false } }],
    })
    expect(await publishInvitationSession(hash, 4, next, sessionId, carrier.attemptId)).toBe(false)
  })

  it('does not promote credentials or change owner when exact carrier authority changed', async () => {
    const { hash, next, sessionId, carrier } = await stagedOAuth()
    await (
      await getWebRedisClient()
    ).set(
      invitationOAuthCarrierKey(carrier.attemptId),
      JSON.stringify({ ...carrier, status: 'started', expectedGeneration: 3 }),
      { expiration: { type: 'PXAT', value: carrier.expiresAt } }
    )
    expect(await publishInvitationSession(hash, 3, next, sessionId, carrier.attemptId)).toBe(false)
    expect(await redisVaultStore.get(sessionId)).toBeNull()
    expect(await invitationOwnerStore.get(hash, carrier.origin)).toMatchObject({
      version: 3,
      pendingOAuthAttemptId: carrier.attemptId,
    })
    expect(await readInvitationOAuthCarrier(carrier.attemptId)).toMatchObject({ status: 'started' })
  })
})
