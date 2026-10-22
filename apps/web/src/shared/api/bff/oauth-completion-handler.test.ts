// @vitest-environment node
import { NextResponse } from 'next/server'
import type * as Shared from '@amcore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ mode: 'path' as 'path' | 'host' }))
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
vi.mock('./oauth-exchange-handler', () => ({ handleOAuthExchange: vi.fn() }))

import { handleOAuthCompletion } from './oauth-completion-handler'
import { oauthCompletionQuerySchema } from './oauth-completion-input'
import { handleOAuthExchange } from './oauth-exchange-handler'

const site = 'https://shop.example.test:9443'
beforeEach(() => {
  vi.clearAllMocks()
  settings.mode = 'path'
  vi.stubEnv('FRONTEND_URL', site)
  vi.stubEnv('PRODUCT_ADMIN_ORIGIN', '')
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-test-frontend-context-key-at-least-32>')
  vi.mocked(handleOAuthExchange).mockResolvedValue(NextResponse.redirect(`${site}/en`, 303))
})
afterEach(() => vi.unstubAllEnvs())

function request({
  origin = site,
  host = new URL(site).host,
  body = 'ticket=t1&locale=en',
  method = 'POST',
  media = 'application/x-www-form-urlencoded',
  query = '',
}: {
  origin?: string | null
  host?: string
  body?: string
  method?: string
  media?: string
  query?: string
} = {}) {
  const headers: Record<string, string> = { host, 'content-type': media }
  if (origin !== null) headers.origin = origin
  return new Request(`${site}/api/auth/oauth/complete${query}`, {
    method,
    headers,
    body: ['GET', 'HEAD'].includes(method) ? undefined : body,
  })
}

describe('completion admission precedes recovery, credential access and publication', () => {
  for (const kind of ['site-auth', 'admin-auth'] as const) {
    it.each([null, 'null', 'https://shop.example.test', 'https://other.example.test:9443'])(
      `${kind} refuses Origin %s`,
      async (origin) => {
        const response = await handleOAuthCompletion(request({ origin }), kind)
        expect(response.status).toBe(403)
        expect(response.headers.has('set-cookie')).toBe(false)
        expect(response.headers.get('referrer-policy')).toBe('no-referrer')
        expect(handleOAuthExchange).not.toHaveBeenCalled()
      }
    )
  }
  it.each(['foreign.example.test:9443', 'shop.example.test:9444'])(
    'refuses actual Host %s',
    async (host) => {
      expect((await handleOAuthCompletion(request({ host }), 'site-auth')).status).toBe(404)
      expect(handleOAuthExchange).not.toHaveBeenCalled()
    }
  )
  it.each(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'])(
    'does not exchange on %s',
    async (method) => {
      expect((await handleOAuthCompletion(request({ method }), 'site-auth')).status).toBe(405)
      expect(handleOAuthExchange).not.toHaveBeenCalled()
    }
  )
  it.each([
    ['ticket=t1&ticket=t2&locale=en', 400],
    ['ticket=t1&locale=en&locale=ru', 400],
    ['ticket=t1&locale=en&frontend=admin', 400],
    ['ticket=t1&locale=de', 400],
    ['ticket=&locale=en', 400],
    ['locale=en', 400],
    ['ticket=%FF&locale=en', 400],
    [`ticket=${'t'.repeat(4097)}&locale=en`, 400],
    [`ticket=${'t'.repeat(8192)}&locale=en`, 413],
  ])('rejects invalid bounded form %#', async (body, status) => {
    const response = await handleOAuthCompletion(request({ body }), 'site-auth')
    expect(response.status).toBe(status)
    expect(response.headers.has('set-cookie')).toBe(false)
    expect(handleOAuthExchange).not.toHaveBeenCalled()
  })
  it.each(['application/json', 'multipart/form-data', 'text/plain'])(
    'refuses %s',
    async (media) => {
      expect((await handleOAuthCompletion(request({ media }), 'site-auth')).status).toBe(415)
      expect(handleOAuthExchange).not.toHaveBeenCalled()
    }
  )
  it('rejects query credentials before any exchange', async () => {
    expect(
      (await handleOAuthCompletion(request({ query: '?ticket=other' }), 'site-auth')).status
    ).toBe(400)
    expect(handleOAuthExchange).not.toHaveBeenCalled()
  })
  it('bounds streamed bytes even when Content-Length claims an empty body', async () => {
    const incoming = request({ body: `ticket=${'t'.repeat(8192)}&locale=en` })
    incoming.headers.set('content-length', '0')
    expect((await handleOAuthCompletion(incoming, 'site-auth')).status).toBe(413)
    expect(handleOAuthExchange).not.toHaveBeenCalled()
  })
  it('refuses a truncated UTF-8 stream before effects', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xc3]))
        controller.close()
      },
    })
    const incoming = new Request(request(), { body, duplex: 'half' } as RequestInit & {
      duplex: 'half'
    })
    expect((await handleOAuthCompletion(incoming, 'site-auth')).status).toBe(400)
    expect(handleOAuthExchange).not.toHaveBeenCalled()
  })
  it('cancels a stalled body at the deadline without exchanging or clearing cookies', async () => {
    vi.useFakeTimers()
    try {
      const cancel = vi.fn()
      const body = new ReadableStream<Uint8Array>({ cancel })
      const incoming = new Request(request(), { body, duplex: 'half' } as RequestInit & {
        duplex: 'half'
      })
      const pending = handleOAuthCompletion(incoming, 'site-auth')
      await vi.advanceTimersByTimeAsync(5000)
      const response = await pending
      expect(response.status).toBe(408)
      expect(response.headers.has('set-cookie')).toBe(false)
      expect(cancel).toHaveBeenCalledOnce()
      expect(handleOAuthExchange).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it('accepts only an admitted form with its selected context', async () => {
    const response = await handleOAuthCompletion(request(), 'site-auth')
    expect(response.status).toBe(303)
    expect(handleOAuthExchange).toHaveBeenCalledWith(
      expect.any(Request),
      { ticket: 't1', locale: 'en' },
      expect.objectContaining({ frontend: 'site', audience: 'product', origin: site })
    )
  })
  it('refuses site completion on staff and admin completion on site', async () => {
    settings.mode = 'host'
    vi.stubEnv('PRODUCT_ADMIN_ORIGIN', 'https://staff.example.test:9443')
    expect(
      (
        await handleOAuthCompletion(
          request({ host: 'staff.example.test:9443', origin: 'https://staff.example.test:9443' }),
          'site-auth'
        )
      ).status
    ).toBe(404)
    expect((await handleOAuthCompletion(request(), 'admin-auth')).status).toBe(404)
    expect(handleOAuthExchange).not.toHaveBeenCalled()
  })
})

it('GET query cannot carry multiple tickets, unknown authority or empty/oversized input', () => {
  for (const input of [
    {},
    { ticket: ['t1', 't2'] },
    { ticket: 't1', frontend: 'admin' },
    { ticket: '' },
    { ticket: 't'.repeat(4097) },
  ])
    expect(oauthCompletionQuerySchema.safeParse(input).success).toBe(false)
  expect(oauthCompletionQuerySchema.safeParse({ ticket: 't1' }).success).toBe(true)
})
