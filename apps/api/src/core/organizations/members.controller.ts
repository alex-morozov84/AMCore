import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiQuery,
  ApiSecurity,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import { ORGANIZATION_CONTEXT_FAMILY } from '@amcore/shared'
import {
  AuthType,
  type InviteResponse,
  type MemberRolesResponse,
  type OrganizationMembersResponse,
  type ReplaceMemberRolesResponse,
  type RequestPrincipal,
} from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'

import { CreateInviteDto, InviteResponseDto } from './dto'
import {
  MemberRolesQueryDto,
  MemberRolesResponseDto,
  OrganizationMembersQueryDto,
  OrganizationMembersResponseDto,
  ReplaceMemberRolesDto,
  ReplaceMemberRolesResponseDto,
} from './dto/organization-members.dto'
import { CurrentInvitationActor, type InvitationActor } from './invitation-actor'
import { InviteService } from './invite.service'
import { MemberService } from './member.service'
import { MemberQueryService } from './member-query.service'
import { MemberRoleSetService } from './member-role-set.service'

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
 * allowlist deletion. The existing credential contract remains unchanged.
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
    private readonly inviteService: InviteService,
    private readonly memberQuery: MemberQueryService,
    private readonly memberRoleSet: MemberRoleSetService
  ) {}

  @ApiParam({ name: 'orgId', description: 'Current organization membership selector' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Default1; bounded offset',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Default20, maximum100' })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Literal name/email contains; maximum100 Unicode code points',
  })
  @ApiBadRequestResponse({ description: 'Invalid query or selector' })
  @ApiNotFoundResponse({ description: 'Organization/member unavailable' })
  @ApiServiceUnavailableResponse({
    description: 'MEMBER_READ_UNAVAILABLE: serialized read budget exceeded',
  })
  @Get()
  @Auth(AuthType.Bearer)
  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @ApiOperation({ summary: 'List organization members; full TeamAccess and membership required' })
  @ZodResponse({ type: OrganizationMembersResponseDto, status: 200 })
  list(
    @Param('orgId') orgId: string,
    @Query() query: OrganizationMembersQueryDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<OrganizationMembersResponse> {
    return this.memberQuery.list(orgId, principal.organizationId, query)
  }

  @ApiParam({ name: 'orgId', description: 'Current organization membership selector' })
  @ApiParam({ name: 'userId', description: 'Target member user ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Default20, maximum100' })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Literal role name search',
  })
  @ApiQuery({ name: 'section', required: false, enum: ['available', 'assigned'] })
  @ApiBadRequestResponse({ description: 'Invalid query or selector' })
  @ApiNotFoundResponse({ description: 'MEMBER_UNAVAILABLE' })
  @ApiServiceUnavailableResponse({ description: 'MEMBER_READ_UNAVAILABLE' })
  @Get(':userId/roles')
  @Auth(AuthType.Bearer)
  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @ApiOperation({ summary: 'Read complete member assignments and paginated role choices' })
  @ZodResponse({ type: MemberRolesResponseDto, status: 200 })
  roles(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Query() query: MemberRolesQueryDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<MemberRolesResponse> {
    return this.memberQuery.roles(orgId, userId, principal.organizationId, query)
  }

  @ApiParam({ name: 'orgId', description: 'Current organization membership selector' })
  @ApiParam({ name: 'userId', description: 'Target member user ID' })
  @ApiBadRequestResponse({ description: 'Validation error or ORGANIZATION_LAST_ADMIN' })
  @ApiNotFoundResponse({ description: 'MEMBER_UNAVAILABLE' })
  @ApiConflictResponse({
    description:
      'MEMBER_ROLES_CONFLICT: membership or ACL generation changed; reread, no automatic replay',
  })
  @ApiPayloadTooLargeResponse({
    description: 'PAYLOAD_TOO_LARGE: decoded body exceeds262144 bytes',
  })
  @ApiServiceUnavailableResponse({
    description:
      'MEMBER_ROLES_SAVE_UNAVAILABLE: outcome may be unknown; reread, never automatic replay',
  })
  @Patch(':userId/roles')
  @Auth(AuthType.Bearer)
  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @ApiOperation({
    summary:
      'Atomically replace up to1000 roles with membership/ACL CAS; decoded JSON262144 bytes maximum',
  })
  @ZodResponse({ type: ReplaceMemberRolesResponseDto, status: 200 })
  replace(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() dto: ReplaceMemberRolesDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<ReplaceMemberRolesResponse> {
    return this.memberRoleSet.replace(orgId, userId, dto, principal)
  }

  @Post('invite')
  @ApiParam({ name: 'orgId', description: 'Target organization selector' })
  @ApiTooManyRequestsResponse({ description: 'Invitation issuance budget exceeded' })
  @ApiBadRequestResponse({ description: 'Invalid request' })
  @ApiNotFoundResponse({ description: 'Organization unavailable' })
  @ApiConflictResponse({ description: 'CONFLICT: known transaction abort' })
  @ApiServiceUnavailableResponse({
    description: 'Write unconfirmed; inspect pending invites before retrying',
  })
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ZodResponse({
    type: InviteResponseDto,
    status: 202,
    description: 'Invitation decision committed; email delivery is best-effort',
  })
  @ApiOperation({
    summary:
      'Invite a user by email — requires full TeamAccess. Returns a uniform 202 ' +
      '{status:"invited"} regardless of whether the email already has an ' +
      'account, is already a member, or is unknown. An invite email ' +
      'carrying the raw accept token is attempted after commit. The ' +
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
    @CurrentInvitationActor() actor: InvitationActor
  ): Promise<InviteResponse> {
    return this.inviteService.createInvite(orgId, dto, actor)
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
