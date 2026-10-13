import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import type { Request, Response } from 'express'
import type { FastifyInstance } from 'fastify'

import { HttpMetricsMiddleware } from './http-metrics.middleware'
import { MetricsController } from './metrics.controller'
import { MetricsService } from './metrics.service'
import { MetricsAuthGuard } from './metrics-auth.guard'

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsAuthGuard, HttpMetricsMiddleware],
  exports: [MetricsService],
})
export class ObservabilityModule implements NestModule {
  constructor(
    private readonly host: HttpAdapterHost,
    private readonly httpMetrics: HttpMetricsMiddleware
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    if (this.host.httpAdapter.getType() === 'fastify') {
      const instance = this.host.httpAdapter.getInstance() as FastifyInstance
      instance.addHook('onRequest', (request, reply, done) => {
        this.httpMetrics.use(request as unknown as Request, reply.raw as Response, done)
      })
      return
    }
    consumer.apply(HttpMetricsMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL })
  }
}
