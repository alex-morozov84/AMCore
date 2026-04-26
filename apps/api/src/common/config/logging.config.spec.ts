import { RequestMethod } from '@nestjs/common'
import type { ClsService } from 'nestjs-cls'
import { PassThrough } from 'stream'

import { createLoggingConfig } from './logging.config'

describe('createLoggingConfig', () => {
  const clsServiceMock = {
    getId: jest.fn().mockReturnValue('test-correlation-id'),
    get: jest.fn(),
  } as unknown as ClsService

  it('redacts nested credential fields and hashed secrets', () => {
    const config = createLoggingConfig(clsServiceMock)

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
    const config = createLoggingConfig(clsServiceMock)

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
    const config = createLoggingConfig(clsServiceMock)
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

  it('redacts oauth access tokens in actual log output', () => {
    const config = createLoggingConfig(clsServiceMock)
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
})
