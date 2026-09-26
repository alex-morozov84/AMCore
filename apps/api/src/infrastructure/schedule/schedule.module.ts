import { Module } from '@nestjs/common'
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule'

import { CleanupModule } from './cleanup.module'

import { GeoipUpdaterModule } from '@/infrastructure/geoip/geoip-updater.module'

/**
 * Scheduler (ADR-041). Adds `@nestjs/schedule`'s `forRoot()` — the explorer that
 * actually registers `@Cron` jobs — and pulls in `CleanupModule` so the nightly
 * `CleanupService.scheduledCleanup` is discovered and scheduled. Imported ONLY by
 * the worker/all roots. `web` never imports this, so its `@Cron` never fires even
 * though `AdminModule` still has `CleanupService` for the manual trigger.
 *
 * `GeoipUpdaterModule` follows the identical split: its
 * `GeoIpUpdateService.scheduledUpdate` daily `@Cron` is only discovered here.
 */
@Module({
  imports: [NestScheduleModule.forRoot(), CleanupModule, GeoipUpdaterModule],
})
export class ScheduleModule {}
