import { Controller, Get, HttpStatus, Res, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProduces } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import type { Response } from 'express'

import { AuthType } from '@amcore/shared'

import { METRICS_ROUTE } from './metrics.constants'
import { MetricsService } from './metrics.service'
import { MetricsAuthGuard } from './metrics-auth.guard'

import { AppException } from '@/common/exceptions'
import { Auth } from '@/core/auth/decorators/auth.decorator'

@Controller(METRICS_ROUTE)
@Auth(AuthType.None)
@SkipThrottle()
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
