import { Reflector } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom, of } from 'rxjs'

import { IdempotencyInterceptor } from './idempotency.interceptor'

describe('IdempotencyInterceptor', () => {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue({ scope: 'orders' }),
  } as unknown as Reflector
  const logger = { setContext: jest.fn(), warn: jest.fn() } as unknown as PinoLogger

  it('fails open on reserve outage when fail mode is open', async () => {
    const store = {
      reserve: jest.fn().mockRejectedValue(new Error('redis down')),
      complete: jest.fn(),
    }
    const env = {
      get: jest.fn().mockImplementation(
        (key: string) =>
          ({
            IDEMPOTENCY_FAIL_MODE: 'open',
            IDEMPOTENCY_LOCK_TTL_SECONDS: 30,
            IDEMPOTENCY_REDIS_TIMEOUT_MS: 100,
          })[key]
      ),
    }
    const interceptor = new IdempotencyInterceptor(reflector, env as never, store as never, logger)
    const res = fakeResponse()

    const result = await lastValueFrom(
      interceptor.intercept(context(res), { handle: () => of({ ok: true }) } as never)
    )

    expect(result).toEqual({ ok: true })
    expect(store.complete).not.toHaveBeenCalled()
  })

  it('stores a 5xx response body when the first execution completes', async () => {
    const store = {
      reserve: jest.fn().mockResolvedValue({
        kind: 'started',
        storageKey: 'idem:v1:orders:key1',
        ownerToken: 'owner',
      }),
      complete: jest.fn().mockResolvedValue(true),
    }
    const env = {
      get: jest.fn().mockImplementation(
        (key: string) =>
          ({
            IDEMPOTENCY_FAIL_MODE: 'open',
            IDEMPOTENCY_LOCK_TTL_SECONDS: 30,
            IDEMPOTENCY_REDIS_TIMEOUT_MS: 100,
            IDEMPOTENCY_RETENTION_SECONDS: 86400,
          })[key]
      ),
    }
    const interceptor = new IdempotencyInterceptor(reflector, env as never, store as never, logger)
    const res = fakeResponse()
    res.statusCode = 500

    const result = await lastValueFrom(
      interceptor.intercept(context(res), { handle: () => of({ error: 'boom' }) } as never)
    )
    res.send(result)
    await flush()

    expect(store.complete).toHaveBeenCalledWith(
      'idem:v1:orders:key1',
      'owner',
      expect.any(String),
      { status: 500, body: '{"error":"boom"}', headers: {} },
      86400
    )
  })

  it('replays a stored response and sets Idempotency-Replayed', async () => {
    const store = {
      reserve: jest.fn().mockResolvedValue({
        kind: 'replay',
        response: {
          status: 201,
          body: '{"ok":true}',
          headers: { 'content-type': 'application/json' },
        },
      }),
    }
    const env = { get: jest.fn() }
    const interceptor = new IdempotencyInterceptor(reflector, env as never, store as never, logger)
    const res = fakeResponse()

    const result = await lastValueFrom(
      interceptor.intercept(context(res), { handle: jest.fn() } as never)
    )

    expect(res.statusCode).toBe(201)
    expect(res.headers['Idempotency-Replayed']).toBe('true')
    expect(result).toBe('{"ok":true}')
  })
})

function context(res: ReturnType<typeof fakeResponse>) {
  return {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        headers: { 'idempotency-key': 'idem-key-1' },
        rawBody: Buffer.from('{"amount":10}'),
        route: { path: '/orders' },
        originalUrl: '/orders',
      }),
      getResponse: () => res,
    }),
  } as never
}

function fakeResponse() {
  return {
    statusCode: 201,
    headers: {} as Record<string, string>,
    sentBody: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value
    },
    getHeader() {
      return undefined
    },
    status(code: number) {
      this.statusCode = code
      return this
    },
    send(body: unknown) {
      this.sentBody = body
      return this
    },
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}
