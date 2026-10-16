import { Module } from '@nestjs/common'

import { EmailModule } from '../../infrastructure/email/index.js'
import { PrismaModule } from '../../prisma/index.js'
import { AuditModule } from '../audit/index.js'
import { AuthModule } from '../auth/auth.module.js'
import { InvitationAuthorityModule } from '../invitations/invitation-authority.module.js'

import { AuthInvitesController } from './auth-invites.controller.js'
import { CapabilitiesController } from './capabilities.controller.js'
import { CapabilityRegistry } from './capability-registry.service.js'
import { InvitationAuthorization } from './invitation-authorization.js'
import { InvitationCommandService } from './invitation-command.service.js'
import { InvitationEmailService } from './invitation-email.service.js'
import { InvitationPublicController } from './invitation-public.controller.js'
import { InvitationQueryService } from './invitation-query.service.js'
import { InviteService } from './invite.service.js'
import { InviteAcceptService } from './invite-accept.service.js'
import { InviteAcceptLimiterService } from './invite-accept-limiter.service.js'
import { InviteOperationsController } from './invite-operations.controller.js'
import { InviteRateLimiterService } from './invite-rate-limiter.service.js'
import { InviteRevokeService } from './invite-revoke.service.js'
import { InvitesController } from './invites.controller.js'
import { MemberService } from './member.service.js'
import { MemberAccessService } from './member-access/member-access.service.js'
import { MemberQueryService } from './member-query.service.js'
import { MemberRoleSetService } from './member-role-set.service.js'
import { MembersController } from './members.controller.js'
import { OrganizationCreationController } from './organization-creation.controller.js'
import { OrganizationCreationService } from './organization-creation.service.js'
import { OrganizationsController } from './organizations.controller.js'
import { OrganizationsService } from './organizations.service.js'
import { PresetPermissionsController } from './preset-permissions.controller.js'
import { RoleService } from './role.service.js'
import { RoleAssignabilityService } from './role-assignability.service.js'
import { RoleDefinitionCommandService } from './role-definition-command.service.js'
import { RoleDefinitionQueryService } from './role-definition-query.service.js'
import { RoleDefinitionsController } from './role-definitions.controller.js'
import { RolesController } from './roles.controller.js'

@Module({
  imports: [
    PrismaModule,
    InvitationAuthorityModule,
    AuthModule, // Provides TokenService (for /switch) + AuthenticationGuard (global) + UserCacheService + EmailIdentityService
    AuditModule,
    EmailModule, // Provides EmailService for invite dispatch (OB-02 Stage D)
  ],
  controllers: [
    OrganizationCreationController,
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
    OrganizationCreationService,
    CapabilityRegistry,
    MemberService,
    MemberQueryService,
    MemberAccessService,
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
