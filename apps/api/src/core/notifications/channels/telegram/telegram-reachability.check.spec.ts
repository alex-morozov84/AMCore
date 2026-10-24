import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { checkTelegram, classifyStatus } from './telegram-reachability.check'

const TOKEN = '123456:secret-token-value'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

function run(fetchImpl: typeof fetch, shutdown = new AbortController().signal) {
  return checkTelegram({
    baseUrl: 'https://relay.example.test/',
    token: TOKEN,
    shutdown,
    fetchImpl,
  })
}

describe('checkTelegram decision order', () => {
  it('a valid bot User is ok, and the request uses the base URL, POST and no redirect', async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<typeof fetch>>(() =>
      Promise.resolve(jsonResponse(200, { ok: true, result: { id: 42, is_bot: true } }))
    )
    await expect(run(fetchImpl as unknown as typeof fetch)).resolves.toEqual({
      result: 'ok',
      failure: null,
    })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`https://relay.example.test/bot${TOKEN}/getMe`)
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' })
  })

  it.each([
    [{ ok: true, result: { id: 42, is_bot: false } }],
    [{ ok: true, result: { id: -1, is_bot: true } }],
    [{ ok: true, result: { id: 42, is_bot: true }, error_code: 401 }],
    [{ ok: false, error_code: 401, description: 'Unauthorized' }],
    [{ ok: true }],
  ])('a 2xx body that is not a clean bot User is invalid_response: %j', async (body) => {
    await expect(run(() => Promise.resolve(jsonResponse(200, body)))).resolves.toEqual({
      result: 'unknown',
      failure: 'invalid_response',
    })
  })

  it('a 2xx with invalid JSON is invalid_response', async () => {
    const reply = new Response('<html>', { status: 200 })
    await expect(run(() => Promise.resolve(reply))).resolves.toEqual({
      result: 'unknown',
      failure: 'invalid_response',
    })
  })

  it('a 2xx over the byte cap is invalid_response, not a network failure', async () => {
    const reply = new Response('x', { status: 200, headers: { 'content-length': '999999' } })
    await expect(run(() => Promise.resolve(reply))).resolves.toEqual({
      result: 'unknown',
      failure: 'invalid_response',
    })
  })

  it('a non-2xx is classified by status alone, whatever its body', async () => {
    const huge = new Response('x', { status: 401, headers: { 'content-length': '999999' } })
    await expect(run(() => Promise.resolve(huge))).resolves.toEqual({
      result: 'failed',
      failure: 'auth_rejected',
    })
    const broken = new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(new Error('broken'))
        },
      }),
      { status: 429 }
    )
    await expect(run(() => Promise.resolve(broken))).resolves.toEqual({
      result: 'unknown',
      failure: 'rate_limited',
    })
  })

  it.each([
    [401, 'failed', 'auth_rejected'],
    [403, 'failed', 'request_rejected'],
    [404, 'failed', 'request_rejected'],
    [400, 'failed', 'request_rejected'],
    [429, 'unknown', 'rate_limited'],
    [408, 'unknown', 'provider_error'],
    [500, 'unknown', 'provider_error'],
    [503, 'unknown', 'provider_error'],
    [302, 'unknown', 'unexpected_response'],
  ])('status %i is %s/%s', (status, result, failure) => {
    expect(classifyStatus(status)).toEqual({ result, failure })
  })

  it('a rejected fetch is unreachable, and the thrown error never leaks', async () => {
    const outcome = await run(() => Promise.reject(new TypeError(`fetch failed ${TOKEN}`)))
    expect(outcome).toEqual({ result: 'failed', failure: 'unreachable' })
    expect(JSON.stringify(outcome)).not.toContain(TOKEN)
  })

  it('our own deadline is timeout, decided by the signal that fired', async () => {
    jest.useFakeTimers()
    try {
      const pending = run((_url, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
        })
      })
      await jest.advanceTimersByTimeAsync(8_000)
      await expect(pending).resolves.toEqual({ result: 'failed', failure: 'timeout' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('shutdown wins over everything and publishes nothing', async () => {
    const shutdown = new AbortController()
    const pending = run((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
      })
    }, shutdown.signal)
    shutdown.abort()
    await expect(pending).resolves.toBe('shutdown')
    shutdown.abort()
    await expect(run(() => Promise.reject(new Error('never')), shutdown.signal)).resolves.toBe(
      'shutdown'
    )
  })

  it('shutdown after a 2xx response arrived still publishes nothing', async () => {
    const shutdown = new AbortController()
    const outcome = await run(() => {
      shutdown.abort()
      return Promise.resolve(jsonResponse(200, { ok: true, result: { id: 42, is_bot: true } }))
    }, shutdown.signal)
    expect(outcome).toBe('shutdown')
  })
})

describe('checkTelegram with the real Node fetch', () => {
  let server: Server
  let base: string
  let redirectTargetHits = 0

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url?.startsWith('/target')) {
        redirectTargetHits += 1
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true, result: { id: 1, is_bot: true } }))
        return
      }
      if (request.url?.startsWith('/redirect/')) {
        response.writeHead(302, { location: `${base}/target` })
        response.end()
        return
      }
      if (request.url?.startsWith('/broken/')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        // Headers and a first chunk reach the client, then the connection breaks.
        response.write('{"ok":true,', () => setTimeout(() => response.destroy(), 20))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, result: { id: 7, is_bot: true } }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  const real = (path: string) =>
    checkTelegram({
      baseUrl: `${base}/${path}`,
      token: TOKEN,
      shutdown: new AbortController().signal,
    })

  it('reads a real success', async () => {
    await expect(real('ok')).resolves.toEqual({ result: 'ok', failure: null })
  })

  it('does not follow a redirect: the target receives zero requests', async () => {
    await expect(real('redirect')).resolves.toEqual({
      result: 'unknown',
      failure: 'unexpected_response',
    })
    expect(redirectTargetHits).toBe(0)
  })

  it('a body that breaks mid-stream is invalid_response', async () => {
    await expect(real('broken')).resolves.toEqual({
      result: 'unknown',
      failure: 'invalid_response',
    })
  })

  it('a closed port is unreachable', async () => {
    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const port = (closed.address() as AddressInfo).port
    await new Promise((resolve) => closed.close(resolve))
    const outcome = await checkTelegram({
      baseUrl: `http://127.0.0.1:${port}`,
      token: TOKEN,
      shutdown: new AbortController().signal,
    })
    expect(outcome).toEqual({ result: 'failed', failure: 'unreachable' })
  })
})
