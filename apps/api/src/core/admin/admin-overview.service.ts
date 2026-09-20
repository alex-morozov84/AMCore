import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import type { HealthCheckResult } from '@nestjs/terminus'

import type { AdminOverviewDependency, AdminOverviewResponse } from '@amcore/shared'

import { EnvService } from '@/env/env.service'
import { ReadinessCheckService } from '@/health'

/**
 * Console Overview status.
 *
 * Deliberately catches `ReadinessCheckService`'s `ServiceUnavailableException`
 * and returns a typed 200 either way: an observed degraded instance must not
 * produce an HTTP 5xx from this endpoint, or the console UI could not tell
 * "the instance told us it isn't ready" apart from "we couldn't reach this
 * endpoint at all" (a real transport failure, handled upstream via the
 * ordinary unavailable-outcome path instead).
 */
@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly readiness: ReadinessCheckService,
    private readonly env: EnvService
  ) {}

  async getOverview(): Promise<AdminOverviewResponse> {
    try {
      const result = await this.readiness.check()
      return this.toResponse('ready', result.details)
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        return this.toResponse('not_ready', this.extractDetails(err))
      }
      throw err
    }
  }

  private extractDetails(err: ServiceUnavailableException): HealthCheckResult['details'] {
    const body = err.getResponse()
    if (typeof body === 'object' && body !== null && 'details' in body) {
      return (body as HealthCheckResult).details
    }
    return {}
  }

  /** Sanitized allowlist: dependency name + up/down/unknown only, never an indicator's own message/detail fields. */
  private toResponse(
    readiness: AdminOverviewResponse['readiness'],
    details: HealthCheckResult['details']
  ): AdminOverviewResponse {
    const dependencies: AdminOverviewDependency[] = Object.entries(details).map(
      ([name, value]) => ({
        name,
        status: value?.status === 'up' || value?.status === 'down' ? value.status : 'unknown',
      })
    )

    return {
      readiness,
      dependencies,
      version: this.env.get('APP_VERSION'),
      processRole: this.env.get('PROCESS_ROLE'),
    }
  }
}
