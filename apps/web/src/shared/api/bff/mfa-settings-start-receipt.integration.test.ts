import { randomUUID } from 'node:crypto'

import type { MfaBrowserCommand } from '@amcore/shared'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { settingsStartReceipt } from './mfa-settings-start-receipt'
import { resolveProductWebContext } from './product-web-context.server'
import { getWebRedisClient } from './redis-client'

let container: StartedRedisContainer
beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start()
  vi.stubEnv('REDIS_URL', container.getConnectionUrl())
  vi.stubEnv('FRONTEND_URL', 'http://localhost:3002')
  vi.stubEnv('PRODUCT_ADMIN_ORIGIN', '')
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-settings-receipt-key-at-least-32>')
})
beforeEach(async () => (await getWebRedisClient()).flushDb())
afterAll(async () => {
  await (await getWebRedisClient()).close()
  await container?.stop()
  vi.unstubAllEnvs()
})

function fixture() {
  const request = new Request('http://localhost:3002/api/auth/mfa', {
    headers: { host: 'localhost:3002', cookie: `amcore_browser_context=${'a'.repeat(43)}` },
  })
  const context = resolveProductWebContext(request.headers, 'site-auth')
  const source = {
    sourceFingerprint: 'b'.repeat(64),
    entry: { userSnapshot: { email: 'fixture@example.test' } },
  }
  const command: MfaBrowserCommand = { action: 'start_code_rotation', operationId: randomUUID() }
  const pending = {
    kind: 'mfa',
    state: 'verify_required',
    purpose: 'rotate_codes',
    expiresAt: new Date(Date.now() + 240000).toISOString(),
    requiredProofs: ['second_factor'],
    remainingCodes: 10,
    generation: 1,
    continuation: 'c'.repeat(43),
    nextAction: 'verify',
    browser: { contextId: 'context-A', generation: 1 },
  }
  return { request, context, source, command, pending }
}

it('retains the private result before exposure and restores the same flow after a lost browser reply', async () => {
  const f = fixture()
  const upstream = vi.fn(async () => {
    const redis = await getWebRedisClient()
    const keys = await redis.keys('web:mfa-settings-start:v1:*')
    const receipt = JSON.parse((await redis.get(keys[0]!))!)
    expect(receipt.phase).toBe('dispatched')
    expect(receipt.operationId).toBe(f.command.operationId)
    expect(receipt.handle).toHaveLength(43)
    expect(receipt.result).toBeUndefined()
    return f.pending
  })
  const first = await settingsStartReceipt(f.request, f.context, f.source, f.command, upstream)
  const recovered = await settingsStartReceipt(
    f.request,
    f.context,
    f.source,
    f.command,
    upstream,
    true
  )
  expect(await recovered.json()).toEqual(await first.json())
  expect(recovered.cookies.get('amcore_auth_pending')?.value).toBe(
    first.cookies.get('amcore_auth_pending')?.value
  )
  expect(recovered.cookies.get('amcore_session')).toBeUndefined()
  expect(upstream).toHaveBeenCalledTimes(1)
  expect(
    JSON.stringify(
      await (
        await settingsStartReceipt(f.request, f.context, f.source, f.command, upstream, true)
      ).json()
    )
  ).not.toContain(f.pending.continuation)
})

it.each(['abandoned', 'advanced_unrecoverable'] as const)(
  'abandons an unknown dispatch without recovering credentials and preserves outcome %s',
  async (state) => {
    const f = fixture()
    const upstream = vi.fn(async (path: string) => {
      if (path === 'settings-start') throw new TypeError('lost upstream response')
      return { state }
    })
    await expect(
      settingsStartReceipt(f.request, f.context, f.source, f.command, upstream)
    ).rejects.toThrow('lost upstream response')
    const resolved = await settingsStartReceipt(
      f.request,
      f.context,
      f.source,
      f.command,
      upstream,
      true
    )
    expect(await resolved.json()).toMatchObject({ view: { kind: 'settings_start', state } })
    expect(resolved.headers.get('set-cookie')).toBeNull()
    expect(upstream.mock.calls.map(([path]) => path)).toEqual([
      'settings-start',
      'settings-start/abandon',
    ])
  }
)

it('fences a missing receipt before a delayed start and never starts an operation while resolving', async () => {
  const f = fixture()
  const upstream = vi.fn(async () => ({ state: 'abandoned' }))
  const response = await settingsStartReceipt(
    f.request,
    f.context,
    f.source,
    f.command,
    upstream,
    true
  )
  expect(await response.json()).toMatchObject({ view: { state: 'abandoned' } })
  expect(upstream).toHaveBeenCalledExactlyOnceWith('settings-start/abandon', {
    operationId: f.command.operationId,
    purpose: 'rotate_codes',
  })
  expect(response.headers.get('set-cookie')).toBeNull()
})

it('does not expose a retained flow to another browser anchor', async () => {
  const f = fixture()
  const upstream = vi.fn(async () => f.pending)
  await settingsStartReceipt(f.request, f.context, f.source, f.command, upstream)
  const other = new Request(f.request, {
    headers: { cookie: `amcore_browser_context=${'d'.repeat(43)}` },
  })
  await expect(
    settingsStartReceipt(other, f.context, f.source, f.command, upstream, true)
  ).rejects.toThrow()
  expect(upstream).toHaveBeenCalledTimes(1)
})
