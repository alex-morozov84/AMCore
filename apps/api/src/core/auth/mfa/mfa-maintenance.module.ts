import { Module } from '@nestjs/common'

import { ScheduledJobsModule } from '../../../infrastructure/schedule/scheduled-jobs.module.js'
import { PrismaModule } from '../../../prisma/index.js'

import { MfaFoundationModule } from './mfa-foundation.module.js'
import { MfaRetentionService } from './mfa-retention.service.js'

/** Worker-only timers and the same local protocol/key startup fence; no business HTTP module. */
@Module({
  imports: [PrismaModule, ScheduledJobsModule, MfaFoundationModule],
  providers: [MfaRetentionService],
})
export class MfaMaintenanceModule {}
