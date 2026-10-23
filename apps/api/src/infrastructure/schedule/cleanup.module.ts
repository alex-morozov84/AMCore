import { Module } from '@nestjs/common'

import { InvitationAuthorityModule } from '../../core/invitations/invitation-authority.module.js'
import { PrismaModule } from '../../prisma/index.js'

import { CleanupService } from './cleanup.service.js'
import { ScheduledJobsModule } from './scheduled-jobs.module.js'
import { SingletonCronRunner } from './singleton-cron.runner.js'

/**
 * Cleanup logic (ADR-041): provides `CleanupService` (and the reusable
 * `SingletonCronRunner`) WITHOUT the `@nestjs/schedule` scheduler. Imported by
 * `AdminModule` so the manual `POST /admin/cleanup` works in every role, while
 * the nightly `@Cron` only fires where `ScheduleModule` (which adds
 * `NestScheduleModule.forRoot()`) is present — i.e. worker/all, never `web`.
 */
@Module({
  imports: [PrismaModule, InvitationAuthorityModule, ScheduledJobsModule],
  providers: [SingletonCronRunner, CleanupService],
  exports: [CleanupService, SingletonCronRunner],
})
export class CleanupModule {}
