import { Controller, Get, HttpException, Module, Param } from '@nestjs/common'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'
import request from 'supertest'

import { AllExceptionsFilter } from '../src/common/exceptions/filters/all-exceptions.filter'
import { HttpExceptionFilter } from '../src/common/exceptions/filters/http-exception.filter'
import { PrismaClientExceptionFilter } from '../src/common/exceptions/filters/prisma-exception.filter'
import { Prisma } from '../src/generated/prisma/client'

@Controller('error-probe')
class ErrorProbeController {
  @Get(':kind')
  get(@Param('kind') kind: string): never {
    if (kind === 'prisma')
      throw new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { target: ['emailCanonical'] },
      })
    if (kind === 'rate')
      throw new HttpException(
        {
          message: 'Rate limited',
          errorCode: 'RATE_LIMIT_EXCEEDED',
          details: { retryAfterSeconds: 12.3 },
        },
        429
      )
    throw new HttpException({ message: 'Validation failed', errorCode: 'VALIDATION_ERROR' }, 400)
  }
}
@Module({ controllers: [ErrorProbeController] })
class ErrorProbeModule {}

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  ['fastify', () => new FastifyAdapter()],
] as const) {
  describe(`HTTP real error filters: ${name}`, () => {
    let app: Awaited<ReturnType<typeof NestFactory.create>>
    beforeAll(async () => {
      const adapter = makeAdapter()
      app = await NestFactory.create(ErrorProbeModule, adapter, { logger: false })
      const logger = {
        setContext: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      } as unknown as PinoLogger
      const cls = { getId: () => 'probe' } as ClsService
      const host = app.get(HttpAdapterHost)
      app.useGlobalFilters(
        new AllExceptionsFilter(host, logger, cls),
        new PrismaClientExceptionFilter(logger, cls, host),
        new HttpExceptionFilter(logger, cls, host)
      )
      await app.init()
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
    })
    afterAll(async () => {
      if (app) await app.close()
    })
    it.each([
      ['validation', 400, 'VALIDATION_ERROR'],
      ['rate', 429, 'RATE_LIMIT_EXCEEDED'],
      ['prisma', 409, 'EMAIL_ALREADY_EXISTS'],
    ])('preserves %s response and redacts query', async (kind, status, errorCode) => {
      const result = await request(app.getHttpServer()).get(
        `/error-probe/${kind}?token=private-input`
      )
      expect(result.status).toBe(status)
      expect(result.body.errorCode).toBe(errorCode)
      expect(result.body.correlationId).toBe('probe')
      expect(result.body.path).not.toContain('private-input')
      expect(result.headers['retry-after']).toBe(kind === 'rate' ? '13' : undefined)
    })
  })
}
