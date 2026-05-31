import { Injectable } from '@nestjs/common'
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'

import { StorageService } from './storage.service'

import { EnvService } from '@/env/env.service'

/**
 * Opt-in storage readiness indicator (registered only when
 * `STORAGE_HEALTH_ENABLED=true`). Uses the current Terminus API
 * (`HealthIndicatorService`), not the deprecated `HealthIndicator` base class.
 *
 * Probe: a single `exists` on `STORAGE_HEALTH_PROBE_KEY`. Cheap and
 * cross-driver — memory/local touch local state, s3 issues a `HeadObject` (real
 * connectivity check). A missing object returns `false` (still `up`); only a
 * genuine failure — bad credentials, unreachable endpoint, broken FS — throws
 * and reports `down`. The probe key is configurable so object-scoped S3
 * credentials can point it inside their allowed prefix (avoids a false 403);
 * `exists` (HEAD on a key) also sidesteps the `HeadBucket` 403 caveat.
 */
@Injectable()
export class StorageHealthIndicator {
  constructor(
    private readonly storage: StorageService,
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly env: EnvService
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key)
    try {
      await this.storage.exists(this.env.get('STORAGE_HEALTH_PROBE_KEY'))
      return indicator.up()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Storage health check failed'
      return indicator.down({ message })
    }
  }
}
