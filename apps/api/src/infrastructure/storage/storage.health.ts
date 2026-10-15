import { Injectable } from '@nestjs/common'
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'
import { PinoLogger } from 'nestjs-pino'

import { StorageService } from './storage.service'
import { classifyFailure } from './storage-failure'

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
 * Missing-key HEAD may still return 403 without ListBucket; that access
 * ambiguity must not be described as a definitive provider outage.
 *
 * `/health/ready` is unauthenticated, so the `down` detail is only a failure
 * class (`access_denied` or `io_error`). The provider's own message (endpoint,
 * bucket, request id) goes to the log, never into the response.
 */
@Injectable()
export class StorageHealthIndicator {
  constructor(
    private readonly storage: StorageService,
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly env: EnvService,
    private readonly logger: PinoLogger
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key)
    try {
      await this.storage.exists(this.env.get('STORAGE_HEALTH_PROBE_KEY'))
      return indicator.up()
    } catch (error) {
      const failure = classifyFailure(error)
      this.logger.warn({
        event: 'storage_health_failed',
        driver: this.env.get('STORAGE_DRIVER'),
        failure,
        err: error,
      })
      return indicator.down({ failure })
    }
  }
}
