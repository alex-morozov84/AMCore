// @vitest-environment node
import type { UserResponse } from '@amcore/shared'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { revokeBackendSession } from './backend-session-revocation'
import { handleCredentialAuth } from './credential-auth-handler'
import { SessionVaultUnavailableError } from './errors'
import { retireFlowsForOrdinaryAuth } from './invitation-auth-lifecycle'
import { getWebRedisClient } from './redis-client'
import { redisVaultStore } from './session-vault-store'
import type * as UpstreamAuth from './upstream-auth'
import { callUpstreamRegister } from './upstream-auth'
import { redisTransportStall } from './vault-redis/test-redis-transport-stall'
import { stopVaultRedis } from './vault-redis/vault-redis'

// Real Redis with the production memory policy: the refusal below is Redis's own
// `OOM command not allowed`, not a mock. The Docker image tag is recorded in REVIEW.
vi.mock('server-only', () => ({}))
vi.mock('./origin-guard', () => ({ isTrustedOrigin: () => true }))
vi.mock('./invitation-auth-lifecycle', () => ({ retireFlowsForOrdinaryAuth: vi.fn() }))
vi.mock('./backend-session-revocation', () => ({ revokeBackendSession: vi.fn() }))
vi.mock('./upstream-auth', async (original) => ({
  ...(await original<typeof UpstreamAuth>()),
  callUpstreamRegister: vi.fn(),
}))

const IMAGE = 'redis:7-alpine'
const user = { id: 'u1', email: 'a@b.co' } as unknown as UserResponse
let container: StartedRedisContainer | undefined

beforeAll(async () => {
  container = await new RedisContainer(IMAGE).start()
  process.env.REDIS_URL = container.getConnectionUrl()
}, 60_000)

afterAll(async () => {
  if (container) await (await getWebRedisClient()).close()
  await container?.stop()
})

async function redis() {
  return getWebRedisClient()
}

/** Puts Redis at its limit: every write that needs memory is refused, reads keep working. */
async function fillMemory() {
  const client = await redis()
  const info = await client.info('memory')
  const used = Number(/used_memory:(\d+)/.exec(info)![1])
  await client.configSet('maxmemory-policy', 'noeviction')
  await client.configSet('maxmemory', String(used))
}

async function releaseMemory() {
  await (await redis()).configSet('maxmemory', '0')
}

const request = () =>
  new Request('http://web.test/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.co', password: 'Passw0rd!' }),
  })

const register = () =>
  handleCredentialAuth(request(), {
    schema: { safeParse: (value: unknown) => ({ success: true, data: value }) } as never,
    backendPath: '/auth/register',
    successStatus: 201,
    registration: true,
  })

const vaultKeys = async () => (await redis()).keys('web:session:v1:*')

beforeEach(() => {
  vi.mocked(callUpstreamRegister).mockResolvedValue({
    outcome: 'created',
    user,
    accessToken: '<test-access>',
    refreshToken: '<test-refresh>',
  })
  vi.mocked(retireFlowsForOrdinaryAuth).mockResolvedValue(undefined as never)
  vi.mocked(revokeBackendSession).mockResolvedValue(undefined)
})

afterEach(async () => {
  await releaseMemory()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('registration under real Redis memory pressure', () => {
  it('Redis itself refuses the vault write with OOM, surfaced as a vault failure', async () => {
    await fillMemory()
    const failure = await redisVaultStore
      .create('pressure-direct', {
        accessToken: 'a',
        refreshToken: 'r',
        accessTokenExpiresAt: Date.now() + 1000,
        userSnapshot: user,
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(SessionVaultUnavailableError)
    // The typed vault error wraps the command failure, whose own cause is Redis's refusal.
    const command = (failure as SessionVaultUnavailableError).cause as Error
    expect(String(command.cause)).toMatch(/OOM/)
  })

  it('reports a created account, sets no cookie and keeps the vault empty under pressure', async () => {
    const before = await vaultKeys()
    await fillMemory()

    const response = await register()

    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      errorCode: 'REGISTRATION_SIGN_IN_REQUIRED',
    })
    expect(revokeBackendSession).toHaveBeenCalledTimes(1)
    expect(await vaultKeys()).toEqual(before)
  })

  // The API is stubbed here: this proves vault publication after memory recovery, not password
  // sign-in to the existing account (the real sign-in is proved on the stand and in the real stack).
  it('publishes a session for a new confirmed registration once memory is available again', async () => {
    await fillMemory()
    expect((await register()).status).toBe(503)
    await releaseMemory()

    const response = await register()

    expect(response.status).toBe(201)
    const sessionId = response.cookies.get('amcore_session')?.value
    expect(sessionId).toBeTruthy()
    expect(await redisVaultStore.get(sessionId!)).toMatchObject({ accessToken: '<test-access>' })
  })

  it('classifies an applied write with a lost reply as created and leaves only an expiring entry', async () => {
    // The vault runs on its own supervised connection: a TCP fixture holds the reply of the
    // session write after Redis executed it, so the caller's deadline ends with an unknown outcome.
    const client = await redis()
    const proxy = await redisTransportStall(container!.getHost(), container!.getMappedPort(6379))
    const directUrl = process.env.REDIS_URL
    process.env.REDIS_URL = `redis://127.0.0.1:${proxy.port}`
    stopVaultRedis()
    proxy.holdRepliesWhen((chunk) => /SET[\s\S]*web:session:v1:/i.test(chunk.toString()))
    const before = new Set(await vaultKeys())

    let response: Awaited<ReturnType<typeof register>>
    try {
      response = await register()
      await proxy.matchedCommand
    } finally {
      proxy.release()
      stopVaultRedis()
      process.env.REDIS_URL = directUrl
      await proxy.close()
    }

    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      errorCode: 'REGISTRATION_SIGN_IN_REQUIRED',
    })
    // The generated session id never leaves the failed call, so the entry cannot be used or
    // deleted by the BFF; it must expire on its own.
    const orphans = (await vaultKeys()).filter((key) => !before.has(key))
    expect(orphans).toHaveLength(1)
    expect(await client.ttl(orphans[0]!)).toBeGreaterThan(0)
  })

  it('does not leak credentials when backend revocation fails during cleanup', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(revokeBackendSession).mockImplementation(async () => {
      console.error('[bff] backend logout failed', { category: 'transport' })
    })
    await fillMemory()

    const response = await register()
    const text = JSON.stringify(await response.json()) + JSON.stringify(log.mock.calls)

    expect(response.status).toBe(503)
    expect(text).not.toContain('<test-refresh>')
    expect(text).not.toContain('<test-access>')
  })
})
