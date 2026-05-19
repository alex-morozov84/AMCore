import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'
import { AuthModule } from '../auth/auth.module'

import { AuthInvitesController } from './auth-invites.controller'
import { InviteService } from './invite.service'
import { InviteAcceptLimiterService } from './invite-accept-limiter.service'
import { InviteRateLimiterService } from './invite-rate-limiter.service'
import { InvitesController } from './invites.controller'
import { MemberService } from './member.service'
import { MembersController } from './members.controller'
import { OrganizationsController } from './organizations.controller'
import { OrganizationsService } from './organizations.service'
import { RoleService } from './role.service'
import { RoleAssignabilityService } from './role-assignability.service'
import { RolesController } from './roles.controller'

@Module({
  imports: [
    PrismaModule,
    AuthModule, // Provides TokenService (for /switch) + AuthenticationGuard (global) + UserCacheService + EmailIdentityService
  ],
  controllers: [
    OrganizationsController,
    MembersController,
    RolesController,
    InvitesController,
    AuthInvitesController,
  ],
  providers: [
    OrganizationsService,
    MemberService,
    RoleService,
    RoleAssignabilityService,
    InviteService,
    InviteRateLimiterService,
    InviteAcceptLimiterService,
  ],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
