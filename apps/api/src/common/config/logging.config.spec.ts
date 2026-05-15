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
