import { randomUUID } from 'node:crypto'

import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { readBrowserAuthAttempt } from './browser-auth-attempt'
import { handleBrowserBootstrap } from './browser-bootstrap-handler'
import { anchorDigest, returnEntrySchema } from './console-return-entry'
import { resolveProductWebContext } from './product-web-context.server'
import { getWebRedisClient } from './redis-client'

let container: StartedRedisContainer
beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start()
  vi.stubEnv('REDIS_URL', container.getConnectionUrl())
  vi.stubEnv('FRONTEND_URL', 'http://localhost:3002')
  vi.stubEnv('PRODUCT_ADMIN_ORIGIN', '')
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-console-return-context-key-at-least-32>')
})
beforeEach(async () => (await getWebRedisClient()).flushDb())
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  await (await getWebRedisClient()).close()
  await container?.stop()
  vi.unstubAllEnvs()
})

it.each([false, true])(
  'allows explicit neutral fallback without inheriting a lost logout return (competitor=%s)',
  async (competitor) => {
    const anchor = 'a'.repeat(43)
    const id = randomUUID()
    const generation = competitor ? 7 : 1
    const view = {
      contextId: 'context-A',
      generation,
      state: 'published',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    }
    function request(returnEntryId?: string) {
      return new Request('http://localhost:3002/api/auth/browser-context', {
        method: 'POST',
        headers: {
          host: 'localhost:3002',
          origin: 'http://localhost:3002',
          'content-type': 'application/json',
          cookie: `amcore_browser_context=${anchor}`,
        },
        body: JSON.stringify({
          entryId: randomUUID(),
          entryKind: 'console',
          locale: 'en',
          ...(returnEntryId ? { returnEntryId } : {}),
        }),
      })
    }
    const first = request(id)
    const context = resolveProductWebContext(first.headers, 'site-auth')
    const entry = returnEntrySchema.parse({
      version: 1,
      id,
      operationId: randomUUID(),
      receiptSecret: 'b'.repeat(43),
      origin: context.origin,
      audience: 'product',
      anchorHash: anchorDigest(anchor),
      sourceFingerprint: 'c'.repeat(64),
      sourceIntent: 'd'.repeat(64),
      userId: 'original-user',
      browser: {
        contextId: 'context-A',
        generation: 1,
        familyId: 'original-family',
        securityVersion: 1,
        audience: 'product',
      },
      destination: '/admin/profile',
      locale: 'en',
      expiresAt: Date.now() + 600000,
      phase: 'logout_dispatched',
      attemptId: randomUUID(),
      pendingHandle: 'e'.repeat(43),
    })
    await (
      await getWebRedisClient()
    ).set(`${context.namespace}:console-return:v1:${id}`, JSON.stringify(entry))
    const upstream = vi.fn(async (url: string) => {
      if (url.endsWith('/bootstrap')) return Response.json({ kind: 'existing', view })
      if (url.endsWith('/logout-result'))
        return Response.json({
          state: 'not_found',
          operationId: entry.operationId,
          returnEntryId: id,
        })
      throw new Error('Unexpected upstream request')
    })
    vi.stubGlobal('fetch', upstream)
    const refused = await handleBrowserBootstrap(first, context)
    expect(refused.status).toBe(401)
    expect(refused.headers.get('set-cookie')).toBeNull()
    expect(await refused.json()).toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
    // This is the fresh URL offered by the explicit UI action, with no old target reference.
    const freshRequest = request()
    const fresh = await handleBrowserBootstrap(freshRequest, context)
    expect(fresh.status).toBe(200)
    expect(fresh.cookies.get('amcore_session')).toBeUndefined()
    const pending = fresh.cookies.get('amcore_auth_pending')!
    const headers = new Headers(freshRequest.headers)
    headers.set('cookie', `amcore_browser_context=${anchor}; ${pending.name}=${pending.value}`)
    const attempt = await readBrowserAuthAttempt(headers, context)
    expect(attempt?.record).toMatchObject({
      state: 'ready',
      browser: { contextId: 'context-A', generation },
      consoleEntry: { locale: 'en' },
    })
    expect(attempt?.record.consoleEntry?.proof).toBeUndefined()
    expect(attempt?.record.id).not.toBe(entry.attemptId)
    expect(
      upstream.mock.calls.filter(
        ([url]) => !url.endsWith('/bootstrap') && !url.endsWith('/logout-result')
      )
    ).toEqual([])
  }
)
