import { Controller, Get, Global, Module, Param } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { createHttpAdapter } from '../src/bootstrap/create-http-adapter'
import { EnvService } from '../src/env/env.service'
import { MetricsService } from '../src/infrastructure/observability/metrics.service'
import { ObservabilityModule } from '../src/infrastructure/observability/observability.module'

const metrics = {
  enabled: true,
  contentType: 'text/plain; version=0.0.4; charset=utf-8',
  metrics: async () => 'probe_metric 1\n',
  inFlightLabels: (method: string) => ({ method, role: 'web' }),
  incHttpInFlight: jest.fn(),
  decHttpInFlight: jest.fn(),
  observeHttpRequest: jest.fn(),
}
@Controller('metric-probe')
class ProbeController {
  @Get(':id')
  get(@Param('id') id: string): { ok: boolean } {
    return { ok: !!id }
  }
}
@Global()
@Module({
  imports: [ObservabilityModule],
  controllers: [ProbeController],
  providers: [
    {
      provide: EnvService,
      useValue: {
        get: (key: string) =>
          key === 'METRICS_ENABLED'
            ? true
            : key === 'METRICS_AUTH_TOKEN'
              ? '<metrics-probe-token>'
              : undefined,
      },
    },
  ],
  exports: [EnvService],
})
class ProbeModule {}

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  ['fastify', () => createHttpAdapter()],
] as const) {
  describe(`HTTP observability transport: ${name}`, () => {
    let app: Awaited<ReturnType<typeof NestFactory.create>>
    beforeAll(async () => {
      const module = await Test.createTestingModule({ imports: [ProbeModule] })
        .overrideProvider(MetricsService)
        .useValue(metrics)
        .compile()
      const adapter = makeAdapter()
      app = module.createNestApplication(adapter, { logger: false })
      app.setGlobalPrefix('api/v1')
      await app.init()
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
    })
    afterAll(async () => {
      if (app) await app.close()
    })
    beforeEach(() => {
      metrics.incHttpInFlight.mockClear()
      metrics.decHttpInFlight.mockClear()
      metrics.observeHttpRequest.mockClear()
    })
    it('records one bounded route and balances flight on finish/close', async () => {
      const result = await request(app.getHttpServer()).get(
        '/api/v1/metric-probe/private-id?token=private-token'
      )
      expect(result.status).toBe(200)
      expect(metrics.incHttpInFlight).toHaveBeenCalledTimes(1)
      expect(metrics.decHttpInFlight).toHaveBeenCalledTimes(1)
      expect(metrics.observeHttpRequest).toHaveBeenCalledWith(
        {
          method: 'GET',
          route: '/api/v1/metric-probe/:id',
          status_code: '200',
        },
        expect.any(Number)
      )
    })
    it('does not put unmatched path data into labels', async () => {
      expect(
        (await request(app.getHttpServer()).get('/api/v1/private-id?token=private-token')).status
      ).toBe(404)
      expect(metrics.decHttpInFlight).toHaveBeenCalledTimes(1)
      const label = metrics.observeHttpRequest.mock.calls[0][0]
      expect(['unmatched', 'unknown']).toContain(label.route)
      expect(label.status_code).toBe('404')
    })
    it('serves the protected exposition with registry content type and excludes scraping', async () => {
      const result = await request(app.getHttpServer())
        .get('/api/v1/metrics')
        .set('Authorization', 'Bearer <metrics-probe-token>')
      expect(result.status).toBe(200)
      expect(result.text).toBe('probe_metric 1\n')
      // Express normalizes parameter order; both must preserve the same media type and parameters.
      const parts = (value: string): string[] =>
        value
          .split(';')
          .map((part) => part.trim())
          .sort()
      const contentType = result.headers['content-type']
      if (!contentType) throw new Error('Missing metrics content type')
      expect(parts(contentType)).toEqual(parts(metrics.contentType))
      expect(metrics.incHttpInFlight).not.toHaveBeenCalled()
    })
    it('rejects missing scrape credentials without counting scraping', async () => {
      expect((await request(app.getHttpServer()).get('/api/v1/metrics')).status).toBe(401)
      expect(metrics.incHttpInFlight).not.toHaveBeenCalled()
    })
  })
}
