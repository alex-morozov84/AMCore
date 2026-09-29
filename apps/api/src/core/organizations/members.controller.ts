import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import { ORGANIZATION_CONTEXT_FAMILY } from '@amcore/shared'
import { AuthType, type InviteResponse, type RequestPrincipal } from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'

import { CreateInviteDto, InviteResponseDto } from './dto'
import { InviteService } from './invite.service'
import { MemberService } from './member.service'

/**
 * Class-level `@Auth(AuthType.Bearer, AuthType.ApiKey)` is an explicit
 * dual-auth opt-in registered in ADR-034's allowlist. API keys may
 * invite/remove/assign roles within their bound organization subject to
 * the CASL `userPerms ∩ scopes` model; the per-handler `@RequireTeamAccess`
 * decorators are the actual authorization gate.
 *
 * OB-02 Stage C deliberately preserves dual-auth on the invite handler —
 * the credential matrix is unchanged by the move to a non-enumerating
 * pending-invite contract. Narrowing invite to bearer-only is a
 * separate decision that would require an ADR-034 amendment and an
 * allowlist deletion. See `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OB-02.
 *
 * The ADR-034 allowlist in `auth-decorator-coverage.spec.ts` enumerates
 * each handler in this controller individually — adding a new handler
 * also requires an allowlist entry (via ADR amendment) for the
 * metadata test to pass. See OA-11.
 *
 * `@ApiSecurity('apiKeyBearer')` (Swagger-visible counterpart of the
 * allowlist) is applied per-handler rather than at class level, matching
 * the convention in `organizations.controller.ts` — `@nestjs/swagger`
 * concatenates class + method `security` arrays rather than allowing a
 * method to opt out, so per-handler application is the only pattern that
 * stays safe if a future handler here ever needs a bearer-only override.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid accepted credential' })
@ApiForbiddenResponse({
  description: 'FORBIDDEN: target, record/field or full TeamAccess authority denied',
})
@Controller('organizations/:orgId/members')
@Auth(AuthType.Bearer, AuthType.ApiKey)
@OrganizationContextBoundary(ORGANIZATION_CONTEXT_FAMILY)
export class MembersController {
  constructor(
    private readonly memberService: MemberService,
    private readonly inviteService: InviteService
  ) {}

  @Post('invite')
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ZodResponse({
    type: InviteResponseDto,
    status: 202,
    description: 'Invite accepted for delivery',
  })
  @ApiOperation({
    summary:
      'Invite a user by email — requires full TeamAccess. Returns a uniform 202 ' +
      '{status:"invited"} regardless of whether the email already has an ' +
      'account, is already a member, or is unknown. An invite email ' +
      'carrying the raw accept token is delivered to the recipient. The ' +
      'pending invite is attached to a membership when the recipient ' +
      'calls POST /auth/invites/accept with that token.',
  })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  invite(
    @Param('orgId') orgId: string,
    @Body() dto: CreateInviteDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<InviteResponse> {
    return this.inviteService.createInvite(orgId, dto, principal)
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({ summary: 'Remove a member from the organization — requires full TeamAccess' })
  @ApiNoContentResponse({ description: 'Member removed' })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  removeMember(
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<void> {
    return this.memberService.removeMember(orgId, targetUserId, principal)
  }

  @Post(':userId/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({ summary: 'Assign a role to a member — requires full TeamAccess' })
  @ApiNoContentResponse({ description: 'Role assigned' })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  assignRole(
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<void> {
    return this.memberService.assignRole(orgId, targetUserId, roleId, principal)
  }

  @Delete(':userId/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({ summary: 'Remove a role from a member — requires full TeamAccess' })
  @ApiNoContentResponse({ description: 'Role removed' })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  removeRole(
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<void> {
    return this.memberService.removeRole(orgId, targetUserId, roleId, principal)
  }
}
