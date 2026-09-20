import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import type { HealthCheckResult } from '@nestjs/terminus'

import { ADMIN_OVERVIEW_DEPENDENCY_NAMES, type AdminOverviewResponse } from '@amcore/shared'

type KnownDependencyName = (typeof ADMIN_OVERVIEW_DEPENDENCY_NAMES)[number]

function isKnownDependencyName(name: string): name is KnownDependencyName {
  return (ADMIN_OVERVIEW_DEPENDENCY_NAMES as readonly string[]).includes(name)
}

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

  /**
   * Sanitized allowlist: only a name in `ADMIN_OVERVIEW_DEPENDENCY_NAMES`
   * is emitted (a future/unexpected Terminus indicator key is dropped
   * entirely, never forwarded to the browser), and only its up/down/unknown
   * status — never an indicator's own message/detail fields.
   */
  private toResponse(
    readiness: AdminOverviewResponse['readiness'],
    details: HealthCheckResult['details']
  ): AdminOverviewResponse {
    const dependencies = Object.entries(details)
      .filter((entry): entry is [KnownDependencyName, HealthCheckResult['details'][string]] =>
        isKnownDependencyName(entry[0])
      )
      .map(([name, value]) => ({
        name,
        status: (value?.status === 'up' || value?.status === 'down' ? value.status : 'unknown') as
          'up' | 'down' | 'unknown',
      }))

    return {
      readiness,
      dependencies,
      version: this.env.get('APP_VERSION'),
      processRole: this.env.get('PROCESS_ROLE'),
    }
  }
}
