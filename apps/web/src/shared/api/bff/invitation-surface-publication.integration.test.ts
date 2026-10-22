import { createHash, randomBytes } from 'node:crypto'

import type * as Shared from '@amcore/shared'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({
  mode: 'path' as 'path' | 'host',
  sessionId: undefined as string | undefined,
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (settings.sessionId ? { value: settings.sessionId } : undefined),
  }),
}))
vi.mock('server-only', () => ({}))
vi.mock('@amcore/shared', async (original) => {
  const actual = await original<typeof Shared>()
  return {
    ...actual,
    get PRODUCT_ADMIN_CONFIG() {
      return { ...actual.PRODUCT_ADMIN_CONFIG, mode: settings.mode }
    },
  }
})

import { contextSessionBinding } from './context-session'
import { publishInvitationAuth, reserveInvitationAuth } from './invitation-auth-transition'
import { admitInvitationFlow, newInvitationOwner } from './invitation-flow-authority'
import { recoverPublishedInvitedOAuth } from './invitation-oauth-recovery'
import { invitationOwnerHash, invitationOwnerStore } from './invitation-owner-store'
import {
  discardInvitationSession,
  publishInvitationSession,
  stageInvitationSession,
} from './invitation-session-publication'
import { invitationSurfaceData } from './invitation-surface'
import { type ProductWebContext, resolveProductWebContext } from './product-web-context.server'
import { getWebRedisClient } from './redis-client'
import type { VaultRecord } from './session-vault.types'
import { redisVaultStore } from './session-vault-store'

let container: StartedRedisContainer
beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start()
  vi.stubEnv('REDIS_URL', container.getConnectionUrl())
  vi.stubEnv('FRONTEND_URL', 'https://shop.example.test')
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-surface-context-key-at-least-32>')
}, 60000)
afterAll(async () => {
  if (container) {
    await (await getWebRedisClient()).close()
    await container.stop()
  }
  vi.unstubAllEnvs()
})

function context(audience: 'product' | 'staff') {
  settings.mode = audience === 'staff' ? 'host' : 'path'
  const origin = audience === 'staff' ? 'https://staff.example.test' : 'https://shop.example.test'
  vi.stubEnv('PRODUCT_ADMIN_ORIGIN', origin)
  return resolveProductWebContext(new Headers({ host: new URL(origin).host }), 'admin-invite')
}

async function staged(context: ProductWebContext) {
  const now = Date.now()
  const admission = admitInvitationFlow(
    {
      ...newInvitationOwner(context.origin, null, now),
      ...invitationSurfaceData(context),
    },
    {
      credential: 'c'.repeat(43),
      expiresAt: new Date(now + 1800000).toISOString(),
      intent: { expectedInviteId: 'surface-invitation', expectedGeneration: 1 },
    },
    'en',
    null,
    now
  )
  const reserved = reserveInvitationAuth(
    admission.owner,
    admission.flow.binding,
    null,
    'login',
    null,
    now
  )
  const proof = randomBytes(32).toString('base64url')
  const hash = invitationOwnerHash(proof)
  await invitationOwnerStore.create(hash, reserved.owner, context)
  const entry: VaultRecord = {
    audience: context.audience,
    accessToken: '<fake-access>',
    refreshToken: '<fake-refresh>',
    accessTokenExpiresAt: now + 900000,
    userSnapshot: { id: 'surface-user' } as VaultRecord['userSnapshot'],
  }
  const deadline = now + 60000
  const id = await stageInvitationSession({
    context,
    ownerHash: hash,
    flowId: reserved.flow.binding.flowId,
    attemptId: reserved.attempt.id,
    deadline,
    entry,
  })
  const next = publishInvitationAuth(
    reserved.owner,
    reserved.flow.binding.flowId,
    reserved.attempt.id,
    reserved.attempt.fence,
    null,
    {
      binding: contextSessionBinding(id, { ...entry, version: 1 }),
      vaultId: id,
      backendId: 'surface-backend',
      deadline,
    },
    now
  )
  return { hash, proof, id, next, entry }
}

describe('v2 invitation publication target vault and metadata', () => {
  it.each(['product', 'staff'] as const)(
    'publishes only the selected %s audience and preserves published credentials during staging cleanup',
    async (audience) => {
      const selected = context(audience)
      const value = await staged(selected)
      expect(await selected.store.get(value.id)).toBeNull()
      expect(
        await publishInvitationSession(value.hash, 1, value.next, value.id, undefined, selected)
      ).toBe(true)
      expect(await selected.store.get(value.id)).toEqual({ ...value.entry, version: 1 })
      if (audience === 'staff') expect(await redisVaultStore.get(value.id)).toBeNull()
      await discardInvitationSession(value.hash, value.id, selected)
      expect(await selected.store.get(value.id)).not.toBeNull()
      expect((await invitationOwnerStore.get(value.hash, selected.origin, selected))!.version).toBe(
        2
      )
    }
  )

  it.each(['audience', 'fingerprint', 'target-vault'])(
    'rejects tampered staged %s inside real Lua without changing owner or publishing a session',
    async (field) => {
      const selected = context('staff')
      const value = await staged(selected)
      const redis = await getWebRedisClient()
      const key = `web:invitation:staged-session:v2:${value.id}`
      const record = JSON.parse((await redis.get(key))!)
      if (field === 'audience') record.entry.audience = 'product'
      else if (field === 'fingerprint') record.placementFingerprint = 'c'.repeat(64)
      else record.vaultKey = `web:session:v1:${value.id}`
      await redis.set(key, JSON.stringify(record), { expiration: { type: 'PX', value: 60000 } })
      expect(
        await publishInvitationSession(value.hash, 1, value.next, value.id, undefined, selected)
      ).toBe(false)
      expect(await selected.store.get(value.id)).toBeNull()
      expect(await redisVaultStore.get(value.id)).toBeNull()
      expect((await invitationOwnerStore.get(value.hash, selected.origin, selected))!.version).toBe(
        1
      )
    }
  )
})

describe('published invited OAuth recovery requires the current selected session', () => {
  it.each(['product', 'staff'] as const)(
    'recovers %s navigation after transient deletion without minting again',
    async (audience) => {
      const selected = context(audience)
      const value = await staged(selected)
      const ticket = 'fake-one-use-ticket'
      value.next.flows[0]!.handoff!.ticketHash = createHash('sha256').update(ticket).digest('hex')
      expect(
        await publishInvitationSession(value.hash, 1, value.next, value.id, undefined, selected)
      ).toBe(true)
      settings.sessionId = value.id
      const request = new Request(`${selected.origin}/api/product-admin/auth/oauth/complete`, {
        method: 'POST',
        headers: {
          host: new URL(selected.origin).host,
          cookie: `__Host-amcore_admin_invite_browser=${value.proof}; ${selected.cookieName}=${value.id}`,
        },
      })
      const recovered = { flowId: value.next.flows[0]!.binding.flowId, locale: 'en' }
      expect(await recoverPublishedInvitedOAuth(request, ticket, selected)).toEqual(recovered)
      expect(await recoverPublishedInvitedOAuth(request, ticket, selected)).toEqual(recovered)
      expect((await invitationOwnerStore.get(value.hash, selected.origin, selected))!.version).toBe(
        2
      )
      expect((await selected.store.get(value.id))!.version).toBe(1)
      expect(await recoverPublishedInvitedOAuth(request, 'other-ticket', selected)).toBeNull()
      settings.sessionId = undefined
      await expect(recoverPublishedInvitedOAuth(request, ticket, selected)).rejects.toThrow()
      expect(
        await recoverPublishedInvitedOAuth(
          new Request(request.url, {
            method: 'POST',
            headers: { host: new URL(selected.origin).host },
          }),
          ticket,
          selected
        )
      ).toBeNull()
      const competingId = randomBytes(32).toString('base64url')
      await selected.store.create(competingId, {
        ...value.entry,
        userSnapshot: { id: 'competing-user' } as VaultRecord['userSnapshot'],
      })
      settings.sessionId = competingId
      await expect(recoverPublishedInvitedOAuth(request, ticket, selected)).rejects.toThrow()
      settings.sessionId = value.id
      const wrongSurface = resolveProductWebContext(
        new Headers({ host: 'shop.example.test' }),
        'site-auth'
      )
      expect(await recoverPublishedInvitedOAuth(request, ticket, wrongSurface)).toBeNull()
      const owner = (await invitationOwnerStore.get(value.hash, selected.origin, selected))!
      const retired = {
        ...owner,
        flows: owner.flows.map((flow) => ({ ...flow, state: 'retired' as const })),
      }
      expect(
        await invitationOwnerStore.compareAndSet(value.hash, owner.version, retired, selected)
      ).toBe(true)
      await expect(recoverPublishedInvitedOAuth(request, ticket, selected)).rejects.toThrow()
      settings.sessionId = undefined
    }
  )
})

describe('real staff vault audience fences', () => {
  it.each(['product', 'console', undefined] as const)(
    'refuses raw %s credentials on reads and Lua CAS',
    async (audience) => {
      const selected = context('staff')
      const value = await staged(selected)
      const redis = await getWebRedisClient()
      const key = `${selected.namespace}:${value.id}`
      const raw = JSON.stringify({ ...value.entry, audience, version: 1 })
      await redis.set(key, raw, { expiration: { type: 'PX', value: 60000 } })
      expect(await selected.store.get(value.id)).toBeNull()
      expect(await selected.store.setIfVersionMatches(value.id, 1, value.entry)).toBe(false)
      expect(await redis.get(key)).toBe(raw)
    }
  )
})
