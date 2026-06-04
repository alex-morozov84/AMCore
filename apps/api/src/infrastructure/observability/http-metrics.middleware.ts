import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

import { METRICS_HTTP_PATH } from './metrics.constants'
import { MetricsService } from './metrics.service'
import { normalizeRouteTemplate } from './route-template'

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (isMetricsRequest(req)) {
      next()
      return
    }

    const method = req.method.toUpperCase()
    const startedAt = process.hrtime.bigint()
    const inFlightLabels = this.metrics.inFlightLabels(method, 'pending')
    this.metrics.incHttpInFlight(inFlightLabels)

    // Record once on whichever fires first: `finish` (response fully sent) or
    // `close` (connection closed, e.g. client abort). Listening to `close` too
    // keeps the in-flight gauge balanced when a request is aborted before
    // `finish` would have fired.
    let recorded = false
    const record = (): void => {
      if (recorded) return
      recorded = true
      this.metrics.decHttpInFlight(inFlightLabels)
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
      this.metrics.observeHttpRequest(
        {
          method,
          route: normalizeRouteTemplate(req),
          status_code: String(res.statusCode),
        },
        durationSeconds
      )
    }

    res.on('finish', record)
    res.on('close', record)

    next()
  }
}

function isMetricsRequest(req: Request): boolean {
  const path = req.originalUrl.split('?')[0]
  return path === METRICS_HTTP_PATH || path === '/metrics'
}
