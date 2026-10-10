import type { PinoLogger } from 'nestjs-pino'

import { serializeNotificationEmail } from '../prepared-email'

import { ResendEmailProvider } from './resend.provider'

import type { EnvService } from '@/env/env.service'

/**
 * Contract test against the REAL installed `resend` SDK (no `jest.mock('resend')` — the other
 * provider spec replaces the SDK entirely and therefore cannot prove any of this). It pins the
 * untyped/private SDK surface the provider depends on, so an SDK upgrade that changes it fails
 * here instead of silently in production:
 *
 * - `emails.send(payload, options)` takes the options as the SECOND argument and spreads them into
 *   `fetch` — the abort `signal` and the `Idempotency-Key` header both arrive;
 * - the error path exposes a flat, lowercase `headers` map, from which `Retry-After` is normalized;
 * - the SDK's private `logError` prints the raw provider error in non-production; the provider
 *   neutralizes it per instance, so a provider-controlled sentinel never reaches the console.
 */
describe('ResendEmailProvider against the real Resend SDK', () => {
  const realFetch = global.fetch
  const realNodeEnv = process.env.NODE_ENV
  let logger: jest.Mocked<Pick<PinoLogger, 'setContext' | 'info' | 'warn' | 'error'>>
  let provider: ResendEmailProvider
  let calls: Array<{ url: string; init: RequestInit }>

  const respond = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      })
    }) as unknown as typeof fetch
  }

  const send = (extra: { signal?: AbortSignal; idempotencyKey?: string } = {}) =>
    provider.send({
      to: 'to@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 'h',
      idempotencyKey: 'notification-delivery:d1',
      ...extra,
    })

  beforeEach(() => {
    calls = []
    logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    const env = {
      get: (key: string) => (key === 'RESEND_API_KEY' ? 're_test_fake' : 'noreply@example.com'),
    } as unknown as EnvService
    provider = new ResendEmailProvider(env, logger as unknown as PinoLogger)
  })

  afterEach(() => {
    global.fetch = realFetch
    process.env.NODE_ENV = realNodeEnv
    jest.restoreAllMocks()
  })

  it('forwards the abort signal (second argument) AND the idempotency header to fetch', async () => {
    respond(200, { id: 'em_1' })
    const controller = new AbortController()

    const result = await send({ signal: controller.signal })

    expect(result).toEqual({ id: 'em_1', success: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.init.signal).toBe(controller.signal)
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get('idempotency-key')).toBe('notification-delivery:d1')
  })

  it('settles with a bounded retryable failure when the signal aborts (no raw error text)', async () => {
    global.fetch = jest.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('SENTINEL-abort-text'), { name: 'AbortError' }))
          )
        })
    ) as unknown as typeof fetch
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const controller = new AbortController()

    const pending = send({ signal: controller.signal })
    controller.abort()
    const result = await pending

    expect(result).toMatchObject({ success: false, retryable: true })
    expect(JSON.stringify(result)).not.toContain('SENTINEL')
  })

  it('normalizes the flat lowercase Retry-After header of a rate-limit response', async () => {
    respond(
      429,
      { name: 'rate_limit_exceeded', message: 'SENTINEL-rate-limit', statusCode: 429 },
      { 'retry-after': '120', 'ratelimit-limit': '10' }
    )

    const result = await send()

    expect(result).toEqual({
      id: '',
      success: false,
      error: 'rate_limit_exceeded',
      retryable: true,
      retryAfterMs: 120_000,
    })
  })

  it('keeps a quota 429 deterministic: permanent, no retry delay', async () => {
    respond(
      429,
      { name: 'daily_quota_exceeded', message: 'quota', statusCode: 429 },
      { 'retry-after': '86400' }
    )
    const result = await send()
    expect(result).toMatchObject({ success: false, retryable: false })
    expect(result).not.toHaveProperty('retryAfterMs')
  })

  it('reports no retry delay when the transport sent none or an unsupported value', async () => {
    respond(
      429,
      { name: 'rate_limit_exceeded', message: 'm', statusCode: 429 },
      { 'retry-after': 'soon' }
    )
    expect(await send()).not.toHaveProperty('retryAfterMs')
    respond(500, { name: 'internal_server_error', message: 'm', statusCode: 500 })
    expect(await send()).not.toHaveProperty('retryAfterMs')
  })

  it.each(['development', 'test', 'production'])(
    'never prints the raw provider error through the SDK (NODE_ENV=%s)',
    async (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined)
      respond(422, {
        name: 'validation_error',
        message: 'SENTINEL-provider-message to@example.com',
        statusCode: 422,
      })

      const result = await send()

      expect(result).toMatchObject({ success: false, retryable: false })
      const printed = JSON.stringify([...consoleError.mock.calls, ...consoleLog.mock.calls])
      expect(printed).not.toContain('SENTINEL')
      // The provider's own bounded warn log carries only codes, not the provider message.
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('SENTINEL')
    }
  )
  it('sends the full prepared body byte-for-byte with the same key through the installed SDK', async () => {
    respond(200, { id: 'em_prepared' })
    const signal = new AbortController().signal
    const params = {
      from: 'Starter <noreply@example.com>',
      to: 'recipient@example.com',
      subject: 'Тест',
      html: '<p>Body</p>',
      text: 'Body',
      replyTo: 'reply@example.com',
    }
    const key = 'notification-delivery:prepared-fixture'
    await provider.send({ ...params, idempotencyKey: key, signal })
    const sdkBody = calls[0]!.init.body
    const prepared = serializeNotificationEmail(params)
    expect(prepared).toBe(sdkBody)
    await provider.sendPrepared(prepared, key, signal)
    await provider.sendPrepared(prepared, key, signal)
    expect(calls).toHaveLength(3)
    for (const call of calls) {
      expect(call.url).toBe('https://api.resend.com/emails')
      expect(call.init.method).toBe('POST')
      expect(call.init.body).toBe(prepared)
      expect(call.init.signal).toBe(signal)
      const headers = new Headers(call.init.headers)
      expect(headers.get('idempotency-key')).toBe(key)
      expect(headers.get('authorization')).toBe('Bearer re_test_fake')
      expect(headers.get('content-type')).toBe('application/json')
    }
    expect(prepared).not.toContain('re_test_fake')
  })

  it('checks the queued fence before SDK fetch and preserves immutable bytes/key', async () => {
    respond(200, { id: 'em_queued' })
    const body = '{"from":"fake@example.test","to":["recipient@example.test"]}'
    const fence = jest.fn(() => {
      expect(calls).toHaveLength(0)
    })
    const outcome = await provider.queuedEmail.send(
      body,
      'email:fake-incarnation',
      new AbortController().signal,
      fence
    )
    expect(outcome).toEqual({ certainty: 'accepted', retryable: false, code: 'COMPLETED' })
    expect(fence).toHaveBeenCalledTimes(1)
    expect(calls[0]!.init.body).toBe(body)
    expect(new Headers(calls[0]!.init.headers).get('idempotency-key')).toBe(
      'email:fake-incarnation'
    )
  })

  it('never fetches when the synchronous queued fence refuses', async () => {
    respond(200, { id: 'em_queued' })
    await expect(
      provider.queuedEmail.send(
        '{}',
        'email:fake-incarnation',
        new AbortController().signal,
        () => {
          throw new Error('FENCE_STALE')
        }
      )
    ).rejects.toThrow('FENCE_STALE')
    expect(calls).toHaveLength(0)
  })

  it.each([429, 500])(
    'does not mistake parsed error.statusCode for actual HTTP truth (%i)',
    async (status) => {
      respond(
        status,
        { name: 'rate_limit_exceeded', statusCode: 429, message: 'SENTINEL' },
        { 'retry-after': 'Mon, 05 Oct 2026 12:02:00 GMT' }
      )
      const outcome = await provider.queuedEmail.send(
        '{}',
        'email:fake-incarnation',
        new AbortController().signal,
        () => undefined
      )
      expect(outcome).toEqual({
        certainty: 'unknown',
        retryable: true,
        code: 'RATE_LIMITED',
        retryAfter: { kind: 'absolute', timestamp: Date.parse('2026-10-05T12:02:00.000Z') },
      })
      expect(JSON.stringify(outcome)).not.toContain('SENTINEL')
    }
  )
})
