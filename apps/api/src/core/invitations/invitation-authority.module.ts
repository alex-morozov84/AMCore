import { Module } from '@nestjs/common'

import { ScheduledJobsModule } from '../../infrastructure/schedule/scheduled-jobs.module.js'
import { ThrottlingModule } from '../../infrastructure/throttling/throttling.module.js'
import { PrismaModule } from '../../prisma/index.js'

import { InvitationAuthHandoffService } from './invitation-auth-handoff.service.js'
import { InvitationContinuationService } from './invitation-continuation.service.js'
import { InvitationLiveSessionService } from './invitation-live-session.service.js'
import { InvitationRequestGuard } from './invitation-request.guard.js'
import { InvitationRetentionService } from './invitation-retention.service.js'

/** Credential authority shared by auth issuance and organization settlement. */
@Module({
  imports: [PrismaModule, ThrottlingModule, ScheduledJobsModule],
  providers: [
    InvitationRetentionService,
    InvitationRequestGuard,
    InvitationAuthHandoffService,
    InvitationContinuationService,
    InvitationLiveSessionService,
  ],
  exports: [
    ThrottlingModule,
    InvitationRetentionService,
    InvitationRequestGuard,
    InvitationAuthHandoffService,
    InvitationContinuationService,
    InvitationLiveSessionService,
  ],
})
export class InvitationAuthorityModule {}
