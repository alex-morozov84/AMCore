import { RequestMethod } from '@nestjs/common'
import type { ClsService } from 'nestjs-cls'
import { PassThrough } from 'stream'

import { createLoggingConfig, truncateBody } from './logging.config'

describe('createLoggingConfig', () => {
  const clsServiceMock = {
    getId: jest.fn().mockReturnValue('test-correlation-id'),
    get: jest.fn(),
  } as unknown as ClsService

  it('redacts nested credential fields and hashed secrets', () => {
    const config = createLoggingConfig(clsServiceMock, 4096)

    const pinoHttp = config.pinoHttp as { redact?: { paths?: string[] } }
    const redactPaths = pinoHttp.redact?.paths
    expect(redactPaths).toEqual(
      expect.arrayContaining([
        'req.body.user.password',
        'req.body.user.passwordHash',
        'req.body.session.refreshToken',
        'req.body.session.tokenHash',
        'req.body.apiKey.keyHash',
        'req.body.apiKey.salt',
        'req.body.oauthAccount.accessToken',
        '*.passwordHash',
        '*.tokenHash',
        '*.keyHash',
        '*.salt',
        // Token-bearing action URLs (EQS-02)
        '*.resetUrl',
        '*.verificationUrl',
        '*.acceptUrl',
        // Webhook secret headers (Arc D — Telegram secret-header verifier)
        'req.headers["stripe-signature"]',
        'req.headers["x-telegram-bot-api-secret-token"]',
      ])
    )
  })

  it('redacts token-bearing action URLs in actual log output (EQS-02)', () => {
    const config = createLoggingConfig(clsServiceMock, 4096)
    const stream = new PassThrough()
    let output = ''

    stream.on('data', (chunk) => {
      output += chunk.toString()
    })

    const nestjsPinoPath = require.resolve('nestjs-pino')
    const pinoPath = require.resolve('pino', { paths: [nestjsPinoPath] })
    const pino = require(pinoPath) as (
      options: object,
      destination: NodeJS.WritableStream
    ) => {
      info: (obj: object, msg: string) => void
    }

    const pinoHttp = config.pinoHttp as { redact?: object }
    const logger = pino({ redact: pinoHttp.redact }, stream)

    logger.info(
      {
        data: {
          resetUrl: 'https://app/reset-password?token=reset-secret',
          verificationUrl: 'https://app/verify-email?token=verify-secret',
          acceptUrl: 'https://app/invite/accept?token=invite-secret',
        },
      },
      'test'
    )

    expect(output).not.toContain('reset-secret')
    expect(output).not.toContain('verify-secret')
    expect(output).not.toContain('invite-secret')
    expect(output).toContain('[REDACTED]')
  })

  it('redacts AI operator reason (body + header) and message content in log output (Arc F.3)', () => {
    const config = createLoggingConfig(clsServiceMock, 4096)
    const stream = new PassThrough()
    let output = ''
    stream.on('data', (chunk) => {
      output += chunk.toString()
    })

    const nestjsPinoPath = require.resolve('nestjs-pino')
    const pinoPath = require.resolve('pino', { paths: [nestjsPinoPath] })
    const pino = require(pinoPath) as (
      options: object,
      destination: NodeJS.WritableStream
    ) => { info: (obj: object, msg: string) => void }

    const pinoHttp = config.pinoHttp as { redact?: object }
    const logger = pino({ redact: pinoHttp.redact }, stream)

    logger.info(
      {
        req: {
          body: {
            reason: 'ticket-reason-sentinel',
            content: [{ type: 'text', text: 'operator-message-sentinel' }],
          },
          headers: { 'x-amcore-operator-reason': 'header-reason-sentinel' },
        },
      },
      'request'
    )

    expect(output).not.toContain('ticket-reason-sentinel')
    expect(output).not.toContain('operator-message-sentinel')
    expect(output).not.toContain('header-reason-sentinel')
    expect(output).toContain('[REDACTED]')
  })

  it('lists the AI operator reason/content redaction paths', () => {
    const config = createLoggingConfig(clsServiceMock, 4096)
    const pinoHttp = config.pinoHttp as { redact?: { paths?: string[] } }
    expect(pinoHttp.redact?.paths).toEqual(
      expect.arrayContaining([
        'req.body.reason',
        'req.body.content',
        'req.headers["x-amcore-operator-reason"]',
      ])
    )
  })

  it('excludes startup health checks from auto logging', () => {
    const config = createLoggingConfig(clsServiceMock, 4096)

    expect(config.exclude).toEqual(
      expect.arrayContaining([
        { path: 'api/v1/health', method: RequestMethod.GET },
        { path: 'api/v1/health/startup', method: RequestMethod.GET },
        { path: 'api/v1/health/ready', method: RequestMethod.GET },
        { path: 'api/v1/health/live', method: RequestMethod.GET },
      ])
    )
  })

  it('redacts nested passwordHash in actual log output', () => {
    const config = createLoggingConfig(clsServiceMock, 4096)
    const stream = new PassThrough()
    let output = ''

    stream.on('data', (chunk) => {
      output += chunk.toString()
    })

    const nestjsPinoPath = require.resolve('nestjs-pino')
    const pinoPath = require.resolve('pino', { paths: [nestjsPinoPath] })
    const pino = require(pinoPath) as (
      options: object,
      destination: NodeJS.WritableStream
    ) => {
      info: (obj: object, msg: string) => void
    }

    const pinoHttp = config.pinoHttp as { redact?: object }
    const logger = pino(
      {
        redact: pinoHttp.redact,
      },
      stream
    )

    logger.info({ user: { passwordHash: 'super-secret-hash' } }, 'test')

    expect(output).not.toContain('super-secret-hash')
    expect(output).toContain('[REDACTED]')
  })

  /**
   * A search-term sentinel must appear NOWHERE in the serialized log
   * line — neither in the structured `req.query.search` (path-redacted)
   * nor in the raw `req.url` query string (a single-string field, which
   * Pino's path redaction cannot reach into; this is what
   * `sanitizeRequestUrl` fixes). Drives the *real* `req` serializer
   * end to end, not just the redact-path config, so a fix that covers
   * only one of the two representations still fails this test.
   */
  describe('search-term sentinel is absent from serialized log output', () => {
    const SENTINEL = 'sentinel-search-alice@example.com'

    function runReqSerializer(url: string, query: Record<string, string>) {
      const config = createLoggingConfig(clsServiceMock, 4096)
      const pinoHttp = config.pinoHttp as {
        redact?: object
        serializers?: { req?: (req: unknown) => unknown }
      }
      const stream = new PassThrough()
      let output = ''
      stream.on('data', (chunk) => {
        output += chunk.toString()
      })

      const nestjsPinoPath = require.resolve('nestjs-pino')
      const pinoPath = require.resolve('pino', { paths: [nestjsPinoPath] })
      const pino = require(pinoPath) as (
        options: object,
        destination: NodeJS.WritableStream
      ) => { info: (obj: object, msg: string) => void }

      const logger = pino({ redact: pinoHttp.redact, serializers: pinoHttp.serializers }, stream)
      const fakeReq = {
        id: 'r1',
        method: 'GET',
        url,
        query,
        params: {},
        headers: {},
        body: undefined,
        socket: {},
      }
      logger.info({ req: fakeReq }, 'request')
      return output
    }

    it('redacts the sentinel from both req.query and the raw req.url', () => {
      const output = runReqSerializer(
        `/api/v1/admin/users?search=${encodeURIComponent(SENTINEL)}`,
        {
          search: SENTINEL,
        }
      )

      expect(output).not.toContain(SENTINEL)
      expect(output).toContain('[REDACTED]')
    })

    it('preserves the path and non-sensitive query keys in the sanitized url', () => {
      const output = runReqSerializer(
        `/api/v1/admin/users?search=${encodeURIComponent(SENTINEL)}&page=2&sortBy=name`,
        { search: SENTINEL, page: '2', sortBy: 'name' }
      )
      const parsed = JSON.parse(output) as { req: { url: string } }

      expect(parsed.req.url).toContain('/api/v1/admin/users')
      expect(parsed.req.url).toContain('page=2')
      expect(parsed.req.url).toContain('sortBy=name')
      expect(parsed.req.url).not.toContain(SENTINEL)
    })

    it('leaves a url with no sensitive query key unchanged', () => {
      const config = createLoggingConfig(clsServiceMock, 4096)
      const pinoHttp = config.pinoHttp as {
        serializers?: { req?: (req: unknown) => unknown }
      }
      const reqSerializer = pinoHttp.serializers?.req
      const result = reqSerializer?.({
        id: 'r1',
        method: 'GET',
        url: '/api/v1/admin/organizations?page=1',
        query: { page: '1' },
        params: {},
        headers: {},
        socket: {},
      }) as { url: string }

      expect(result.url).toBe('/api/v1/admin/organizations?page=1')
    })

    it('fails closed to a redaction marker on a malformed url, never the original', () => {
      const config = createLoggingConfig(clsServiceMock, 4096)
      const pinoHttp = config.pinoHttp as {
        serializers?: { req?: (req: unknown) => unknown }
      }
      const reqSerializer = pinoHttp.serializers?.req
      const result = reqSerializer?.({
        id: 'r1',
        method: 'GET',
        url: undefined,
        query: {},
        params: {},
        headers: {},
        socket: {},
      }) as { url: string }

      expect(result.url).toBe('[REDACTED]')
    })
  })

  describe('truncateBody', () => {
    it('returns null/undefined as-is', () => {
      expect(truncateBody(undefined, 4096)).toBeUndefined()
      expect(truncateBody(null, 4096)).toBeNull()
    })

    it('passes small body through unchanged so redact paths still resolve', () => {
      const body = { email: 'a@b.com', password: 'x' }
      expect(truncateBody(body, 4096)).toBe(body)
    })

    it('truncates over-cap body to a marker with size + top-level keys', () => {
      const big = { field: 'x'.repeat(5000), other: 1 }
      const result = truncateBody(big, 4096) as {
        _truncated: boolean
        _originalBytes: number
        _maxBytes: number
        _topLevelKeys?: string[]
      }
      expect(result._truncated).toBe(true)
      expect(result._maxBytes).toBe(4096)
      expect(result._originalBytes).toBeGreaterThan(4096)
      expect(result._topLevelKeys).toEqual(['field', 'other'])
    })

    it('omits topLevelKeys for arrays', () => {
      const big = Array.from({ length: 1000 }, (_, i) => ({ i, pad: 'x'.repeat(20) }))
      const result = truncateBody(big, 1024) as {
        _truncated: boolean
        _topLevelKeys?: string[]
      }
      expect(result._truncated).toBe(true)
      expect(result._topLevelKeys).toBeUndefined()
    })

    it('returns a safe marker when body cannot be serialized', () => {
      const circular: Record<string, unknown> = {}
      circular.self = circular
      const result = truncateBody(circular, 4096) as { _truncated: boolean }
      expect(result._truncated).toBe(true)
    })

    it('treats maxBytes=0 as "always truncate" (disable body content)', () => {
      const body = { a: 1 }
      const result = truncateBody(body, 0) as { _truncated: boolean }
      expect(result._truncated).toBe(true)
    })
  })

  it('redacts oauth access tokens in actual log output', () => {
    const config = createLoggingConfig(clsServiceMock, 4096)
    const stream = new PassThrough()
    let output = ''

    stream.on('data', (chunk) => {
      output += chunk.toString()
    })

    const nestjsPinoPath = require.resolve('nestjs-pino')
    const pinoPath = require.resolve('pino', { paths: [nestjsPinoPath] })
    const pino = require(pinoPath) as (
      options: object,
      destination: NodeJS.WritableStream
    ) => {
      info: (obj: object, msg: string) => void
    }

    const pinoHttp = config.pinoHttp as { redact?: object }
    const logger = pino(
      {
        redact: pinoHttp.redact,
      },
      stream
    )

    logger.info(
      {
        oauthAccount: {
          accessToken: 'provider-access-token',
        },
      },
      'test'
    )

    expect(output).not.toContain('provider-access-token')
    expect(output).toContain('[REDACTED]')
  })

  it('emits truncated body marker through the real pino serializer pipeline', () => {
    const config = createLoggingConfig(clsServiceMock, 256)
    const stream = new PassThrough()
    let output = ''

    stream.on('data', (chunk) => {
      output += chunk.toString()
    })

    const nestjsPinoPath = require.resolve('nestjs-pino')
    const pinoPath = require.resolve('pino', { paths: [nestjsPinoPath] })
    const pino = require(pinoPath) as (
      options: object,
      destination: NodeJS.WritableStream
    ) => {
      info: (obj: object, msg: string) => void
    }

    const pinoHttp = config.pinoHttp as {
      serializers?: { req?: (req: unknown) => unknown }
    }
    const reqSerializer = pinoHttp.serializers?.req
    expect(reqSerializer).toBeDefined()

    const oversizedBody = { huge: 'x'.repeat(1024), name: 'leaked-sentinel' }
    const fakeReq = {
      id: 'r1',
      method: 'POST',
      url: '/test',
      query: {},
      params: {},
      headers: {},
      body: oversizedBody,
      socket: {},
    }

    const logger = pino({ serializers: pinoHttp.serializers }, stream)
    logger.info({ req: fakeReq }, 'request')

    expect(output).toContain('"_truncated":true')
    expect(output).toContain('"_maxBytes":256')
    expect(output).toContain('"_topLevelKeys":["huge","name"]')
    expect(output).not.toContain('leaked-sentinel')
    expect(output).not.toContain('xxxxxxxxxxxxxxxx')
  })
})
