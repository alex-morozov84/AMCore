import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'

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
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL })
  }
}
