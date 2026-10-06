import { Module } from '@nestjs/common'

import { ThrottlingModule } from '../../infrastructure/throttling/throttling.module'
import { PrismaModule } from '../../prisma'

import { InvitationAuthHandoffService } from './invitation-auth-handoff.service'
import { InvitationContinuationService } from './invitation-continuation.service'
import { InvitationLiveSessionService } from './invitation-live-session.service'
import { InvitationRequestGuard } from './invitation-request.guard'
import { InvitationRetentionService } from './invitation-retention.service'

/** Credential authority shared by auth issuance and organization settlement. */
@Module({
  imports: [PrismaModule, ThrottlingModule],
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
