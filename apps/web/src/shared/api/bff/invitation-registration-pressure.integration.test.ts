// @vitest-environment node
import { randomUUID } from 'node:crypto'

import { DEFAULT_LOCALE, type UserResponse } from '@amcore/shared'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContextExecutorDeps } from './context-executor'
import { invitationCookiePolicy } from './invitation-cookie'
import { invitationCredentialHandler } from './invitation-credential-handler'
import {
  admitInvitationFlow,
  currentInvitationFlow,
  newInvitationOwner,
} from './invitation-flow-authority'
import { invitationOwnerHash, invitationOwnerStore } from './invitation-owner-store'
import { captureInvitationRequest } from './invitation-request-snapshot'
import type * as InvitationUpstream from './invitation-upstream'
import { invitationBackend, invitationBackendNoContent } from './invitation-upstream'
import { getWebRedisClient } from './redis-client'
import { redisVaultStore } from './session-vault-store'

// Real Redis, real owner store, reservation, publication and recovery. Only the API calls and
// the request-cookie snapshot are replaced. The failure is injected at a semantic boundary:
// the API stub fills Redis memory exactly when it confirms creation, so the reservation has
// already succeeded and the account is "created" before the first publication write is refused.
vi.mock('server-only', () => ({}))
vi.mock('./invitation-request-snapshot', () => ({ captureInvitationRequest: vi.fn() }))
vi.mock('./invitation-upstream', async (original) => ({
  ...(await original<typeof InvitationUpstream>()),
  invitationBackend: vi.fn(),
  invitationBackendNoContent: vi.fn(),
}))

const ORIGIN = 'https://app.example.test'
let container: StartedRedisContainer | undefined
let ownerHash = ''
let flowId = ''
let binding: unknown

beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start()
  process.env.REDIS_URL = container.getConnectionUrl()
}, 60_000)

afterAll(async () => {
  if (container) await (await getWebRedisClient()).close()
  await container?.stop()
})

const redis = () => getWebRedisClient()

async function fillMemory() {
  const client = await redis()
  const used = Number(/used_memory:(\d+)/.exec(await client.info('memory'))![1])
  await client.configSet('maxmemory-policy', 'noeviction')
  await client.configSet('maxmemory', String(used))
}
const releaseMemory = async () => (await redis()).configSet('maxmemory', '0')

const user = {
  id: 'example-user',
  email: 'invited@example.test',
  name: 'Example',
  emailVerified: false,
  phone: null,
  avatarUrl: null,
  locale: DEFAULT_LOCALE,
  timezone: 'UTC',
  createdAt: new Date().toISOString(),
  lastLoginAt: null,
} as UserResponse

/** A structurally valid access token: only its `sub` and `sid` claims are read by the BFF. */
const accessToken = () => {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none' })}.${part({ sub: user.id, sid: 'issued-session-1' })}.signature`
}

const request = () =>
  new Request(`${ORIGIN}/api/invitation-flows/${flowId}/register`, {
    method: 'POST',
    headers: { origin: ORIGIN },
    body: JSON.stringify({
      binding,
      password: 'Test-password-123!',
      name: user.name,
      locale: DEFAULT_LOCALE,
    }),
  })

const deps = { store: redisVaultStore } as ContextExecutorDeps
const register = () => invitationCredentialHandler(request(), flowId, 'register', deps)
const vaultKeys = async () => (await redis()).keys('web:session:v1:*')

beforeEach(async () => {
  const now = Date.now()
  const admitted = admitInvitationFlow(
    newInvitationOwner(ORIGIN, null, now),
    {
      credential: 'c'.repeat(43),
      expiresAt: new Date(now + 1_800_000).toISOString(),
      intent: { expectedInviteId: 'invitation-example', expectedGeneration: 1 },
    },
    DEFAULT_LOCALE,
    null,
    now
  )
  ownerHash = invitationOwnerHash(randomUUID())
  flowId = admitted.flow.binding.flowId
  binding = admitted.flow.binding
  await invitationOwnerStore.create(ownerHash, admitted.owner)
  vi.mocked(captureInvitationRequest).mockImplementation((async () => {
    const owner = (await invitationOwnerStore.get(ownerHash, ORIGIN))!
    return {
      ownerHash,
      policy: invitationCookiePolicy(ORIGIN),
      owner,
      flow: currentInvitationFlow(owner, flowId, null, Date.now()),
      session: null,
    }
  }) as never)
  vi.mocked(invitationBackendNoContent).mockResolvedValue(undefined)
})

afterEach(async () => {
  await releaseMemory()
  vi.clearAllMocks()
})

describe('invited registration under real Redis memory pressure', () => {
  it('refuses before the API is called when the reservation cannot be written', async () => {
    await fillMemory()

    const response = await register()

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect((await response.json()).errorCode).not.toBe('REGISTRATION_SIGN_IN_REQUIRED')
    expect(invitationBackend).not.toHaveBeenCalled()
  })

  it('reports a created account when publication is refused after the API confirmed creation', async () => {
    vi.mocked(invitationBackend).mockImplementation(async () => {
      await fillMemory()
      return { data: { user, accessToken: accessToken() }, refreshToken: '<test-refresh>' }
    })
    const before = await vaultKeys()

    const response = await register()

    // Recovery may call the API again (handoff abort); registration itself is issued once.
    const registrations = vi
      .mocked(invitationBackend)
      .mock.calls.filter(([path]) => path === '/auth/invites/register')
    expect(registrations).toHaveLength(1)
    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      errorCode: 'REGISTRATION_SIGN_IN_REQUIRED',
    })
    expect(await vaultKeys()).toEqual(before)
    // Recovery could not write under pressure, so the flow stays pending: the page reads it
    // through its existing recovery action once memory is available.
    await releaseMemory()
    const owner = (await invitationOwnerStore.get(ownerHash, ORIGIN))!
    expect(owner.flows.find((flow) => flow.binding.flowId === flowId)?.state).toBe('authenticating')
  })

  it('never exposes credentials in the failure response', async () => {
    vi.mocked(invitationBackend).mockImplementation(async () => {
      await fillMemory()
      return { data: { user, accessToken: accessToken() }, refreshToken: '<test-refresh>' }
    })

    const response = await register()
    const text = JSON.stringify(await response.json())

    expect(text).not.toContain('<test-refresh>')
    expect(text).not.toContain('issued-session-1')
  })
})
