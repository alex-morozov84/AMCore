import { Module } from '@nestjs/common'

import { EmailModule } from '../../infrastructure/email'
import { PrismaModule } from '../../prisma'
import { AuditModule } from '../audit'
import { AuthModule } from '../auth/auth.module'
import { InvitationAuthorityModule } from '../invitations/invitation-authority.module'

import { AuthInvitesController } from './auth-invites.controller'
import { CapabilitiesController } from './capabilities.controller'
import { CapabilityRegistry } from './capability-registry.service'
import { InvitationAuthorization } from './invitation-authorization'
import { InvitationCommandService } from './invitation-command.service'
import { InvitationEmailService } from './invitation-email.service'
import { InvitationPublicController } from './invitation-public.controller'
import { InvitationQueryService } from './invitation-query.service'
import { InviteService } from './invite.service'
import { InviteAcceptService } from './invite-accept.service'
import { InviteAcceptLimiterService } from './invite-accept-limiter.service'
import { InviteOperationsController } from './invite-operations.controller'
import { InviteRateLimiterService } from './invite-rate-limiter.service'
import { InviteRevokeService } from './invite-revoke.service'
import { InvitesController } from './invites.controller'
import { MemberService } from './member.service'
import { MemberQueryService } from './member-query.service'
import { MemberRoleSetService } from './member-role-set.service'
import { MembersController } from './members.controller'
import { OrganizationsController } from './organizations.controller'
import { OrganizationsService } from './organizations.service'
import { PresetPermissionsController } from './preset-permissions.controller'
import { RoleService } from './role.service'
import { RoleAssignabilityService } from './role-assignability.service'
import { RoleDefinitionCommandService } from './role-definition-command.service'
import { RoleDefinitionQueryService } from './role-definition-query.service'
import { RoleDefinitionsController } from './role-definitions.controller'
import { RolesController } from './roles.controller'

@Module({
  imports: [
    PrismaModule,
    InvitationAuthorityModule,
    AuthModule, // Provides TokenService (for /switch) + AuthenticationGuard (global) + UserCacheService + EmailIdentityService
    AuditModule,
    EmailModule, // Provides EmailService for invite dispatch (OB-02 Stage D)
  ],
  controllers: [
    OrganizationsController,
    CapabilitiesController,
    PresetPermissionsController,
    MembersController,
    RoleDefinitionsController,
    RolesController,
    InvitesController,
    AuthInvitesController,
    InvitationPublicController,
    InviteOperationsController,
  ],
  providers: [
    OrganizationsService,
    CapabilityRegistry,
    MemberService,
    MemberQueryService,
    MemberRoleSetService,
    RoleService,
    RoleDefinitionQueryService,
    RoleDefinitionCommandService,
    RoleAssignabilityService,
    InviteService,
    InvitationCommandService,
    InvitationEmailService,
    InvitationQueryService,

    InviteAcceptService,
    InviteRevokeService,
    InvitationAuthorization,
    InviteRateLimiterService,
    InviteAcceptLimiterService,
  ],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
