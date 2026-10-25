// @vitest-environment node
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'

import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchBackendResponse } from './backend-transport'

vi.mock('server-only', () => ({}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing listener')
  return `http://127.0.0.1:${address.port}`
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
}

describe('backend sender boundary', () => {
  it('sets the claim last, strips spoofable headers and preserves selected proofs/body/signal', async () => {
    vi.stubEnv('API_URL', 'http://api.test')
    vi.stubEnv('WEB_TRUSTED_CLIENT_IP_HEADER', 'x-real-ip')
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', send)
    const source = new Headers({ 'x-real-ip': '203.0.113.7', cookie: 'browser=secret' })
    const headers = new Headers({
      cookie: 'refresh_token=<fake>',
      'x-amcore-frontend': 'proof',
      'x-forwarded-host': 'bad',
      forwarded: 'bad',
      [AMCORE_CLIENT_IP_HEADER]: 'bad',
    })
    const body = new ReadableStream()
    const signal = new AbortController().signal
    await fetchBackendResponse('/api/v1/auth/refresh', source, {
      method: 'POST',
      headers,
      body,
      duplex: 'half',
      signal,
    })
    const [url, init] = send.mock.calls[0]!
    expect(url).toBe('http://api.test/api/v1/auth/refresh')
    expect(init).toMatchObject({ body, signal, duplex: 'half', redirect: 'error' })
    expect(Object.fromEntries(init.headers)).toEqual({
      cookie: 'refresh_token=<fake>',
      'x-amcore-frontend': 'proof',
      [AMCORE_CLIENT_IP_HEADER]: '203.0.113.7',
    })
    expect(headers.get('forwarded')).toBe('bad')
    expect(source.get('cookie')).toBe('browser=secret')
  })
  it.each([
    'https://foreign.test/',
    '//foreign.test/',
    '/\\foreign.test/',
    'http://user:pass@api.test/',
    'file:///etc/hosts',
  ])('refuses %s before sending', (target) => {
    vi.stubEnv('API_URL', 'http://api.test')
    const send = vi.fn()
    vi.stubGlobal('fetch', send)
    expect(() => fetchBackendResponse(target, new Headers())).toThrow(TypeError)
    expect(send).not.toHaveBeenCalled()
  })
  it('rejects Request and runtime follow bypasses', () => {
    vi.stubEnv('API_URL', 'http://api.test')
    expect(() =>
      fetchBackendResponse(new Request('http://api.test') as never, new Headers())
    ).toThrow(TypeError)
    expect(() => fetchBackendResponse('/', new Headers(), { redirect: 'follow' as never })).toThrow(
      TypeError
    )
  })
  it('never follows real same-origin or cross-origin redirects', async () => {
    let reached = 0
    const target = createServer((_req, res) => {
      reached++
      res.end('leaked')
    })
    const targetUrl = await listen(target)
    const origin = createServer((req, res) => {
      if (req.url === '/target') {
        reached++
        res.end('leaked')
        return
      }
      res.writeHead(302, { Location: req.url === '/same' ? '/target' : targetUrl })
      res.end()
    })
    const base = await listen(origin)
    vi.stubEnv('API_URL', base)
    vi.stubEnv('WEB_TRUSTED_CLIENT_IP_HEADER', 'x-real-ip')
    try {
      for (const route of ['/same', '/cross']) {
        await expect(
          fetchBackendResponse(route, new Headers({ 'x-real-ip': '203.0.113.7' }))
        ).rejects.toThrow()
        expect(
          (await fetchBackendResponse(route, new Headers(), { redirect: 'manual' })).status
        ).toBe(302)
      }
      expect(reached).toBe(0)
    } finally {
      await close(origin)
      await close(target)
    }
  })
})
