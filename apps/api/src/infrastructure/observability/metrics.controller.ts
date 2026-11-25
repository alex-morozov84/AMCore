import { Controller, Get, HttpStatus, Res, UseGuards } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { ApiExtension, ApiOkResponse, ApiProduces, ApiResponse, ApiSecurity } from '@nestjs/swagger'
import type { Response } from 'express'

import { AuthType } from '@amcore/shared'

import { httpExceptionSchema } from '../../bootstrap/common-error-openapi.js'
import { OPENAPI_RATE_LIMIT } from '../../bootstrap/rate-limit-openapi.js'
import { AppException } from '../../common/exceptions/index.js'
import { Auth } from '../../core/auth/decorators/auth.decorator.js'
// Import the decorator file directly, NOT the `infrastructure/throttling`
// barrel: the barrel re-exports GcraRedisLimiter, which imports
// MetricsService from this module (`../observability`) — going through the
// barrel here would close that cycle back on itself. rate-limit.decorator.ts
// has no transitive dependency on observability, so this is cycle-free.
import { SkipRateLimit } from '../throttling/rate-limit.decorator.js'

import { METRICS_ROUTE } from './metrics.constants.js'
import { MetricsService } from './metrics.service.js'
import { MetricsAuthGuard } from './metrics-auth.guard.js'

@Controller(METRICS_ROUTE)
@Auth(AuthType.None)
@SkipRateLimit()
@ApiExtension(OPENAPI_RATE_LIMIT, false)
@UseGuards(MetricsAuthGuard)
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly host: HttpAdapterHost
  ) {}

  @Get()
  @ApiProduces('text/plain')
  @ApiSecurity({})
  @ApiSecurity('metricsBearer')
  @ApiResponse({
    status: 401,
    description: 'METRICS_AUTH_INVALID: the configured scrape token is missing or invalid',
    content: { 'application/json': { schema: httpExceptionSchema } },
  })
  @ApiResponse({
    status: 404,
    description: 'NOT_FOUND: metrics are disabled',
    content: { 'application/json': { schema: httpExceptionSchema } },
  })
  @ApiOkResponse({
    description: 'Prometheus metrics exposition',
    schema: { type: 'string' },
  })
  async scrape(@Res({ passthrough: true }) res: Response): Promise<string> {
    if (!this.metrics.enabled) {
      throw new AppException('Metrics endpoint is disabled', HttpStatus.NOT_FOUND, 'NOT_FOUND')
    }

    // Use the registry's own exposition content type rather than a hardcoded
    // literal, so the header stays correct if the format ever changes.
    this.host.httpAdapter.setHeader(res, 'Content-Type', this.metrics.contentType)
    return this.metrics.metrics()
  }
}
