import { get } from 'node:http'

import { type ExecutionContext, Module } from '@nestjs/common'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import type { ClsService } from 'nestjs-cls'
import { PinoLogger } from 'nestjs-pino'
import request from 'supertest'

import { SystemRole } from '@amcore/shared'

import { AllExceptionsFilter } from '../src/common/exceptions/filters/all-exceptions.filter'
import { NotificationStreamController } from '../src/core/notifications/notification-stream.controller'
import { NotificationRealtimeHub } from '../src/core/notifications/realtime/notification-realtime.hub'
import { EnvService } from '../src/env/env.service'
import { MetricsService } from '../src/infrastructure/observability'

const metrics = {
  incNotificationRealtimeConnections: jest.fn(),
  decNotificationRealtimeConnections: jest.fn(),
  incNotificationRealtimeEvent: jest.fn(),
}
const logger = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() }
const values: Record<string, number> = {
  NOTIFICATIONS_REALTIME_MAX_CONNECTIONS: 1,
  NOTIFICATIONS_REALTIME_MAX_PER_USER: 1,
  NOTIFICATIONS_REALTIME_HEARTBEAT_MS: 60000,
  NOTIFICATIONS_REALTIME_QUEUE_DEPTH: 8,
  NOTIFICATIONS_REALTIME_MAX_STREAM_LIFETIME_MS: 60000,
}
@Module({
  controllers: [NotificationStreamController],
  providers: [
    NotificationRealtimeHub,
    { provide: EnvService, useValue: { get: (key: string) => values[key] } },
    { provide: MetricsService, useValue: metrics },
    { provide: PinoLogger, useValue: logger },
  ],
})
class SseProbeModule {}

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  ['fastify', () => new FastifyAdapter()],
] as const) {
  describe(`HTTP real notification SSE: ${name}`, () => {
    let app: Awaited<ReturnType<typeof NestFactory.create>>
    let url: string
    beforeEach(async () => {
      jest.clearAllMocks()
      app = await NestFactory.create(SseProbeModule, makeAdapter(), { logger: false })
      // Admission fixture supplies a principal; production authentication remains a separate gate.
      app.useGlobalGuards({
        canActivate(ctx: ExecutionContext) {
          const req = ctx.switchToHttp().getRequest()
          app
            .get(HttpAdapterHost)
            .httpAdapter.setHeader(ctx.switchToHttp().getResponse(), 'x-probe-security', 'retained')
          req.user = {
            type: 'jwt',
            sub: 'probe',
            systemRole: SystemRole.User,
            exp: Math.floor(Date.now() / 1000) + (req.headers['x-probe-expired'] ? -1 : 60),
          }
          return true
        },
      })
      app.useGlobalFilters(
        new AllExceptionsFilter(
          app.get(HttpAdapterHost),
          logger as unknown as PinoLogger,
          { getId: () => 'probe' } as ClsService
        )
      )
      await app.listen(0, '127.0.0.1')
      url = await app.getUrl()
    })
    afterEach(async () => {
      await app.close()
    })

    it('keeps expiry errors as JSON before stream ownership', async () => {
      const result = await request(url).get('/notifications/stream').set('x-probe-expired', 'yes')
      expect(result.status).toBe(401)
      expect(result.headers['content-type']).toContain('application/json')
      expect(metrics.incNotificationRealtimeConnections).not.toHaveBeenCalled()
    })

    it('opens ready stream, rejects capacity as JSON, and releases disconnected client', async () => {
      const call = get(`${url}/notifications/stream`)
      try {
        const response = await new Promise<import('node:http').IncomingMessage>(
          (resolve, reject) => {
            call.once('error', reject)
            call.once('response', resolve)
          }
        )
        expect(response.statusCode).toBe(200)
        expect(response.headers['content-type']).toBe('text/event-stream')
        expect(response.headers['cache-control']).toBe('no-cache, no-transform')
        expect(response.headers['x-probe-security']).toBe('retained')
        const frame = await new Promise<string>((resolve, reject) => {
          response.once('error', reject)
          response.once('data', (chunk: Buffer) => resolve(chunk.toString()))
        })
        expect(frame).toContain(': ready\n\n')
        const rejected = await request(url).get('/notifications/stream')
        expect(rejected.status).toBe(503)
        expect(rejected.headers['content-type']).toContain('application/json')
        const released = new Promise<void>((resolve) => {
          metrics.decNotificationRealtimeConnections.mockImplementationOnce(() => resolve())
        })
        response.destroy()
        await released
        expect(metrics.incNotificationRealtimeConnections).toHaveBeenCalledTimes(1)
        expect(metrics.decNotificationRealtimeConnections).toHaveBeenCalledTimes(1)
      } finally {
        call.destroy()
        app.get(NotificationRealtimeHub).closeAll()
      }
    })
  })
}
