import { Module } from '@nestjs/common'

import { CleanupService } from './cleanup.service'
import { SingletonCronRunner } from './singleton-cron.runner'

import { PrismaModule } from '@/prisma'

/**
 * Cleanup logic (ADR-041): provides `CleanupService` (and the reusable
 * `SingletonCronRunner`) WITHOUT the `@nestjs/schedule` scheduler. Imported by
 * `AdminModule` so the manual `POST /admin/cleanup` works in every role, while
 * the nightly `@Cron` only fires where `ScheduleModule` (which adds
 * `NestScheduleModule.forRoot()`) is present — i.e. worker/all, never `web`.
 */
@Module({
  imports: [PrismaModule],
  providers: [SingletonCronRunner, CleanupService],
  exports: [CleanupService, SingletonCronRunner],
})
export class CleanupModule {}
