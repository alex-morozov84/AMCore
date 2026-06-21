import { TelegramBotApiClient } from './telegram-bot-api.client'

import type { EnvService } from '@/env/env.service'

const TOKEN = 'bot-token-123'
const BASE_URL = 'https://fake.telegram.local'

function makeClient(baseUrl: string | undefined = BASE_URL): TelegramBotApiClient {
  const env = {
    get: (key: string) =>
      key === 'TELEGRAM_BOT_TOKEN' ? TOKEN : key === 'TELEGRAM_API_BASE_URL' ? baseUrl : undefined,
  } as unknown as EnvService
  return new TelegramBotApiClient(env)
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]!)
      else controller.close()
    },
  })
}

/** Minimal `Response` stand-in carrying a real HTTP status + a streamed body. */
function response(status: number, body: unknown, contentLength?: string): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(body))
  return {
    status,
    headers: {
      get: (h: string) => (h.toLowerCase() === 'content-length' ? (contentLength ?? null) : null),
    },
    body: streamOf([bytes]),
    text: async () => new TextDecoder().decode(bytes),
  } as unknown as Response
}

/** A streamed response whose chunks/cancellation can be observed (for the byte-ceiling tests). */
function streamingResponse(
  status: number,
  chunks: Uint8Array[]
): { resp: Response; cancelled: { value: boolean }; pulls: { count: number } } {
  let i = 0
  const cancelled = { value: false }
  const pulls = { count: 0 }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls.count += 1
      if (i < chunks.length) controller.enqueue(chunks[i++]!)
      else controller.close()
    },
    cancel() {
      cancelled.value = true
    },
  })
  return {
    resp: {
      status,
      headers: { get: () => null },
      body,
      text: async () => '',
    } as unknown as Response,
    cancelled,
    pulls,
  }
}

function mockFetch(resp: Response): jest.Mock {
  const fetchMock = jest.fn().mockResolvedValue(resp)
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('TelegramBotApiClient.sendMessage', () => {
  afterEach(() => jest.restoreAllMocks())

  it('maps HTTP 200 + ok:true to delivered with the message id', async () => {
    mockFetch(response(200, { ok: true, result: { message_id: 42 } }))
    const result = await makeClient().sendMessage({ chatId: '111', text: 'hi' })
    expect(result).toEqual({ status: 'delivered', providerMessageId: '42' })
  })

  it('does NOT treat a non-2xx body claiming ok:true as delivered', async () => {
    mockFetch(response(500, { ok: true }))
    const result = await makeClient().sendMessage({ chatId: '111', text: 'hi' })
    expect(result).toEqual({ status: 'transient', errorCode: 'telegram_provider_transient' })
  })

  it('sends plain text (no parse_mode) to the token-bearing sendMessage URL', async () => {
    const fetchMock = mockFetch(response(200, { ok: true, result: { message_id: 1 } }))
    await makeClient().sendMessage({ chatId: '111', text: 'hello' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${BASE_URL}/bot${TOKEN}/sendMessage`)
    const body = JSON.parse((init as { body: string }).body)
    expect(body).toEqual({ chat_id: '111', text: 'hello' })
    expect(body).not.toHaveProperty('parse_mode')
  })

  it('normalizes a trailing slash on the base URL (no //bot)', async () => {
    const fetchMock = mockFetch(response(200, { ok: true, result: { message_id: 1 } }))
    await makeClient(`${BASE_URL}/`).sendMessage({ chatId: '1', text: 'x' })
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE_URL}/bot${TOKEN}/sendMessage`)
  })

  it('falls back to the public Bot API base URL when unset', async () => {
    const fetchMock = mockFetch(response(200, { ok: true, result: { message_id: 1 } }))
    const env = {
      get: (key: string) => (key === 'TELEGRAM_BOT_TOKEN' ? TOKEN : undefined),
    } as unknown as EnvService
    await new TelegramBotApiClient(env).sendMessage({ chatId: '1', text: 'x' })
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
  })

  it('maps HTTP 429 + retry_after to transient rate_limited with a ms floor', async () => {
    mockFetch(response(429, { ok: false, parameters: { retry_after: 30 } }))
    const result = await makeClient().sendMessage({ chatId: '111', text: 'hi' })
    expect(result).toEqual({
      status: 'transient',
      errorCode: 'telegram_rate_limited',
      retryAfterMs: 30_000,
    })
  })

  it('is rate_limited on HTTP 429 even with a degraded (empty) body', async () => {
    mockFetch(response(429, {}))
    const result = await makeClient().sendMessage({ chatId: '111', text: 'hi' })
    expect(result).toEqual({ status: 'transient', errorCode: 'telegram_rate_limited' })
  })

  it('ignores a non-positive / non-safe retry_after', async () => {
    mockFetch(response(429, { parameters: { retry_after: 0 } }))
    const result = await makeClient().sendMessage({ chatId: '111', text: 'hi' })
    expect(result).toEqual({ status: 'transient', errorCode: 'telegram_rate_limited' })
  })

  it('maps HTTP 403 to permanent telegram_blocked', async () => {
    mockFetch(response(403, { ok: false, description: 'Forbidden: bot was blocked' }))
    expect(await makeClient().sendMessage({ chatId: '1', text: 'h' })).toEqual({
      status: 'permanent',
      errorCode: 'telegram_blocked',
    })
  })

  it('maps HTTP 400 chat not found to permanent telegram_chat_not_found', async () => {
    mockFetch(response(400, { ok: false, description: 'Bad Request: chat not found' }))
    expect(await makeClient().sendMessage({ chatId: '1', text: 'h' })).toEqual({
      status: 'permanent',
      errorCode: 'telegram_chat_not_found',
    })
  })

  it('maps HTTP 400 + migrate_to_chat_id to permanent telegram_migrated without leaking the value', async () => {
    mockFetch(response(400, { ok: false, parameters: { migrate_to_chat_id: -1009999 } }))
    const result = await makeClient().sendMessage({ chatId: '1', text: 'h' })
    expect(result).toEqual({ status: 'permanent', errorCode: 'telegram_migrated' })
    expect(JSON.stringify(result)).not.toContain('1009999')
  })

  it('maps HTTP 5xx to transient', async () => {
    mockFetch(response(502, { ok: false }))
    expect(await makeClient().sendMessage({ chatId: '1', text: 'h' })).toEqual({
      status: 'transient',
      errorCode: 'telegram_provider_transient',
    })
  })

  it('maps HTTP 408 to transient', async () => {
    mockFetch(response(408, { ok: false }))
    expect(await makeClient().sendMessage({ chatId: '1', text: 'h' })).toEqual({
      status: 'transient',
      errorCode: 'telegram_provider_transient',
    })
  })

  it.each([
    [400, 'Bad Request: message text is empty'],
    [401, 'Unauthorized'],
    [404, 'Not Found: method not found'],
  ])(
    'maps deterministic %s to permanent telegram_provider_permanent',
    async (status, description) => {
      mockFetch(response(status, { ok: false, description }))
      expect(await makeClient().sendMessage({ chatId: '1', text: 'h' })).toEqual({
        status: 'permanent',
        errorCode: 'telegram_provider_permanent',
      })
    }
  )

  it('maps a network throw to transient, never surfacing the token', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNRESET'))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await makeClient().sendMessage({ chatId: '111', text: 'hi' })
    expect(result).toEqual({ status: 'transient', errorCode: 'telegram_provider_transient' })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('treats an unparseable body as transient (2xx anomaly)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => null },
      text: async () => 'not json',
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    expect(await makeClient().sendMessage({ chatId: '1', text: 'h' })).toEqual({
      status: 'transient',
      errorCode: 'telegram_provider_transient',
    })
  })

  it('rejects an over-size response body (bounded parse) as transient', async () => {
    mockFetch(response(200, { ok: true, result: { message_id: 1 }, pad: 'x'.repeat(70_000) }))
    expect(await makeClient().sendMessage({ chatId: '1', text: 'h' })).toEqual({
      status: 'transient',
      errorCode: 'telegram_provider_transient',
    })
  })

  it('enforces the byte ceiling on a chunked body and cancels the stream early', async () => {
    const chunk = new Uint8Array(20 * 1024) // 20KB × 10 = 200KB, ceiling is 64KB
    const { resp, cancelled, pulls } = streamingResponse(
      200,
      Array.from({ length: 10 }, () => chunk)
    )
    globalThis.fetch = jest.fn().mockResolvedValue(resp) as unknown as typeof fetch
    const result = await makeClient().sendMessage({ chatId: '1', text: 'h' })
    expect(result).toEqual({ status: 'transient', errorCode: 'telegram_provider_transient' })
    expect(cancelled.value).toBe(true)
    expect(pulls.count).toBeLessThan(10) // cancelled before draining the whole stream
  })

  it('counts UTF-8 bytes, not UTF-16 length, for the ceiling (multibyte overflow)', async () => {
    // 25k × 3-byte char = 75KB of bytes, but String.length is only 25k (< the 64KB ceiling),
    // so the old text.length check would have let it through.
    const bytes = new TextEncoder().encode('☃'.repeat(25_000))
    expect(bytes.byteLength).toBeGreaterThan(64 * 1024)
    const { resp } = streamingResponse(200, [bytes])
    globalThis.fetch = jest.fn().mockResolvedValue(resp) as unknown as typeof fetch
    expect(await makeClient().sendMessage({ chatId: '1', text: 'h' })).toEqual({
      status: 'transient',
      errorCode: 'telegram_provider_transient',
    })
  })

  it('rejects a too-large declared content-length without reading the body', async () => {
    const text = jest.fn(async () => '{}')
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? '200000' : null) },
      text,
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await makeClient().sendMessage({ chatId: '1', text: 'h' })
    expect(result).toEqual({ status: 'transient', errorCode: 'telegram_provider_transient' })
    expect(text).not.toHaveBeenCalled()
  })

  it('aborts after the timeout, maps to transient, and clears the timer', async () => {
    jest.useFakeTimers()
    const fetchMock = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        })
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const promise = makeClient().sendMessage({ chatId: '1', text: 'h' })
    await jest.advanceTimersByTimeAsync(8000)
    await expect(promise).resolves.toEqual({
      status: 'transient',
      errorCode: 'telegram_provider_transient',
    })
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
  })
})

describe('TelegramBotApiClient.setWebhook', () => {
  afterEach(() => jest.restoreAllMocks())

  it('sends url + secret + allowed_updates:[message] and returns true on HTTP 200 + ok', async () => {
    const fetchMock = mockFetch(response(200, { ok: true, result: true }))
    const ok = await makeClient().setWebhook('https://app.example/webhooks/telegram', 'sec', false)
    expect(ok).toBe(true)
    const init = fetchMock.mock.calls[0]![1] as { body: string }
    expect(JSON.parse(init.body)).toEqual({
      url: 'https://app.example/webhooks/telegram',
      secret_token: 'sec',
      allowed_updates: ['message'],
      drop_pending_updates: false,
    })
  })

  it('returns false on a non-2xx status', async () => {
    mockFetch(response(401, { ok: false }))
    expect(await makeClient().setWebhook('https://app.example/wh', 'sec')).toBe(false)
  })

  it('returns false when ok:false despite HTTP 200', async () => {
    mockFetch(response(200, { ok: false }))
    expect(await makeClient().setWebhook('https://app.example/wh', 'sec')).toBe(false)
  })
})
