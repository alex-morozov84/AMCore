import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import type { HealthCheckResult } from '@nestjs/terminus'

import { ADMIN_OVERVIEW_DEPENDENCY_NAMES, type AdminOverviewResponse } from '@amcore/shared'

type KnownDependencyName = (typeof ADMIN_OVERVIEW_DEPENDENCY_NAMES)[number]

function isKnownDependencyName(name: string): name is KnownDependencyName {
  return (ADMIN_OVERVIEW_DEPENDENCY_NAMES as readonly string[]).includes(name)
}

import { AdminOverviewResourcesService } from './admin-overview-resources.service'

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
    private readonly env: EnvService,
    private readonly resources: AdminOverviewResourcesService
  ) {}

  async getOverview(): Promise<AdminOverviewResponse> {
    const observation = await this.observeReadiness()
    const samples = await this.resources.sample()
    const api = {
      version: safeMetadata(this.env.get('APP_VERSION')),
      commit: safeMetadata(this.env.get('APP_COMMIT')),
      deploymentId: this.env.get('APP_DEPLOYMENT_ID') ?? null,
      environment: this.env.get('APP_ENVIRONMENT') ?? null,
      runtimeMode: this.env.get('NODE_ENV'),
    }
    return {
      ...observation,
      ...samples,
      api,
      version: api.version ?? 'unknown',
      processRole: this.env.get('PROCESS_ROLE'),
      storageHealthEnabled: this.env.get('STORAGE_HEALTH_ENABLED'),
    }
  }

  private async observeReadiness(): Promise<
    Pick<AdminOverviewResponse, 'readiness' | 'dependencies' | 'checkedAt'>
  > {
    try {
      const result = await this.readiness.check()
      if (result.status !== 'ok' && result.status !== 'degraded') {
        throw new Error('Unexpected readiness result')
      }
      return this.toResponse(result.status === 'degraded' ? 'degraded' : 'ready', result.details)
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
  ): Pick<AdminOverviewResponse, 'readiness' | 'dependencies' | 'checkedAt'> {
    const dependencies = Object.entries(details)
      .filter((entry): entry is [KnownDependencyName, HealthCheckResult['details'][string]] =>
        isKnownDependencyName(entry[0])
      )
      .map(([name, value]) => ({
        name,
        status: (value?.status === 'up' || value?.status === 'down' || value?.status === 'degraded'
          ? value.status
          : 'unknown') as 'up' | 'down' | 'degraded' | 'unknown',
      }))

    return {
      readiness,
      dependencies,
      checkedAt: new Date().toISOString(),
    }
  }
}

function safeMetadata(value: string): string | null {
  const normalized = value.trim()
  return normalized !== 'unknown' && /^[A-Za-z0-9._+-]{1,128}$/.test(normalized) ? normalized : null
}
