import { Module } from '@nestjs/common'
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule'

import { GeoipUpdaterModule } from '../geoip/geoip-updater.module.js'

import { CleanupModule } from './cleanup.module.js'
import { ScheduledJobsModule } from './scheduled-jobs.module.js'
import { ScheduledJobsRegistrar } from './scheduled-jobs.registrar.js'

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
  imports: [NestScheduleModule.forRoot(), CleanupModule, GeoipUpdaterModule, ScheduledJobsModule],
  providers: [ScheduledJobsRegistrar],
})
export class ScheduleModule {}
