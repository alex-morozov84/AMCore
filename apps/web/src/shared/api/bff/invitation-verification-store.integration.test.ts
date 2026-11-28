import { randomUUID } from 'node:crypto'

import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { SessionVaultUnavailableError } from './errors'
import {
  admitInvitationFlow,
  newInvitationOwner,
  retireInvitationFlows,
} from './invitation-flow-authority'
import { invitationOwnerHash, invitationOwnerStore } from './invitation-owner-store'
import {
  consumeInvitationVerificationSelector,
  createInvitationVerificationSelector,
  readInvitationVerificationSelector,
} from './invitation-verification-store'
import * as redisClient from './redis-client'
import { createBffRedisClient } from './redis-client-options'
import { redisTransportStall } from './vault-redis/test-redis-transport-stall'

vi.mock('server-only', () => ({}))
let container: StartedRedisContainer | undefined
let proxy: Awaited<ReturnType<typeof redisTransportStall>>
beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start()
  proxy = await redisTransportStall(container.getHost(), container.getMappedPort(6379))
  process.env.REDIS_URL = `redis://127.0.0.1:${proxy.port}`
}, 60000)
afterAll(async () => {
  if (container) await (await redisClient.getWebRedisClient()).close()
  await proxy?.close()
  await container?.stop()
})

async function fixture() {
  const now = Date.now()
  const binding = 'a'.repeat(64)
  const initial = admitInvitationFlow(
    newInvitationOwner('https://app.example.test', binding, now),
    {
      credential: 'c'.repeat(43),
      expiresAt: new Date(now + 1800000).toISOString(),
      intent: { expectedInviteId: 'example-invitation', expectedGeneration: 1 },
    },
    'en',
    binding,
    now
  )
  const hash = invitationOwnerHash(randomUUID())
  await invitationOwnerStore.create(hash, initial.owner)
  const record = {
    ownerHash: hash,
    origin: initial.owner.origin,
    binding: initial.flow.binding,
    ownerEpoch: initial.owner.epoch,
    expiresAt: now + 1800000,
  }
  const id = await createInvitationVerificationSelector(record)
  return { initial, hash, record, id }
}

describe('verification return selector authority on real Redis', () => {
  it('consumes once only for the current owner, origin, session and revision', async () => {
    const { hash, record, id } = await fixture()
    expect(await readInvitationVerificationSelector(id, 'b'.repeat(64), record.origin)).toBeNull()
    expect(
      await readInvitationVerificationSelector(id, hash, 'https://other.example.test')
    ).toBeNull()
    expect(
      await consumeInvitationVerificationSelector(id, hash, 1, {
        ...record,
        binding: { ...record.binding, sessionBinding: 'b'.repeat(64) },
      })
    ).toBe(false)
    expect(await consumeInvitationVerificationSelector(id, hash, 2, record)).toBe(false)
    expect(await readInvitationVerificationSelector(id, hash, record.origin)).toEqual(record)
    expect(await consumeInvitationVerificationSelector(id, hash, 1, record)).toBe(true)
    expect(await consumeInvitationVerificationSelector(id, hash, 1, record)).toBe(false)
  })

  it('does not consume after ordinary auth retired the captured flow and epoch', async () => {
    const { initial, hash, record, id } = await fixture()
    expect(
      await invitationOwnerStore.compareAndSet(
        hash,
        1,
        retireInvitationFlows(initial.owner, 'b'.repeat(64))
      )
    ).toBe(true)
    expect(await consumeInvitationVerificationSelector(id, hash, 2, record)).toBe(false)
    expect(await readInvitationVerificationSelector(id, hash, record.origin)).not.toBeNull()
  })

  it('does not consume after a flow revision changed within the same actor session', async () => {
    const { initial, hash, record, id } = await fixture()
    const next = {
      ...initial.owner,
      flows: initial.owner.flows.map((flow) => ({
        ...flow,
        binding: { ...flow.binding, flowRevision: flow.binding.flowRevision + 1 },
      })),
    }
    expect(await invitationOwnerStore.compareAndSet(hash, 1, next)).toBe(true)
    expect(await consumeInvitationVerificationSelector(id, hash, 2, record)).toBe(false)
    expect(await readInvitationVerificationSelector(id, hash, record.origin)).not.toBeNull()
  })
})

describe('verification return selector after an uncertain Redis result', () => {
  it.each(['reply held', 'command held'])('keeps the selector one-use when %s', async (fault) => {
    const { hash, record, id } = await fixture()
    const direct = createBffRedisClient(container!.getConnectionUrl())
    await direct.connect()
    const connection = vi.spyOn(redisClient, 'getWebRedisClient')
    const consume = () => consumeInvitationVerificationSelector(id, hash, 1, record)
    const read = () => readInvitationVerificationSelector(id, hash, record.origin)
    try {
      if (fault === 'reply held') proxy.holdReplies()
      else proxy.holdCommands()
      await expect(consume()).rejects.toBeInstanceOf(SessionVaultUnavailableError)
      connection.mockResolvedValueOnce(direct)
      expect(await read()).toEqual(fault === 'reply held' ? null : record)
      connection.mockResolvedValueOnce(direct)
      expect(await consume()).toBe(fault === 'command held')
      proxy.release()
      expect(await read()).toBeNull()
      expect(await consume()).toBe(false)
    } finally {
      connection.mockRestore()
      proxy.release()
      await direct.close()
    }
  })
})
