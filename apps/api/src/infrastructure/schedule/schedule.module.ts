import { Module } from '@nestjs/common'
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule'

import { CleanupModule } from './cleanup.module'

/**
 * Scheduler (ADR-041). Adds `@nestjs/schedule`'s `forRoot()` — the explorer that
 * actually registers `@Cron` jobs — and pulls in `CleanupModule` so the nightly
 * `CleanupService.scheduledCleanup` is discovered and scheduled. Imported ONLY by
 * the worker/all roots. `web` never imports this, so its `@Cron` never fires even
 * though `AdminModule` still has `CleanupService` for the manual trigger.
 */
@Module({
  imports: [NestScheduleModule.forRoot(), CleanupModule],
})
export class ScheduleModule {}
