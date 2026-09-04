import { Controller, Get, HttpStatus, Res, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProduces } from '@nestjs/swagger'
import type { Response } from 'express'

import { AuthType } from '@amcore/shared'

import { METRICS_ROUTE } from './metrics.constants'
import { MetricsService } from './metrics.service'
import { MetricsAuthGuard } from './metrics-auth.guard'

import { AppException } from '@/common/exceptions'
import { Auth } from '@/core/auth/decorators/auth.decorator'
// Import the decorator file directly, NOT the `infrastructure/throttling`
// barrel: the barrel re-exports GcraRedisLimiter, which imports
// MetricsService from this module (`../observability`) — going through the
// barrel here would close that cycle back on itself. rate-limit.decorator.ts
// has no transitive dependency on observability, so this is cycle-free.
import { SkipRateLimit } from '@/infrastructure/throttling/rate-limit.decorator'

@Controller(METRICS_ROUTE)
@Auth(AuthType.None)
@SkipRateLimit()
@UseGuards(MetricsAuthGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiProduces('text/plain')
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
    res.setHeader('Content-Type', this.metrics.contentType)
    return this.metrics.metrics()
  }
}
