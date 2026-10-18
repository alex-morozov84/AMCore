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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'

import { ORGANIZATION_CONTEXT_FAMILY } from '@amcore/shared'
import {
  AuthType,
  type MemberAccess,
  type MemberRolesResponse,
  type OrganizationMembersResponse,
  type ReplaceMemberRolesResponse,
  type RequestPrincipal,
} from '@amcore/shared'

import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { Auth } from '../auth/decorators/auth.decorator.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy.js'

import {
  MemberAccessResponseDto,
  MemberRemovalQueryDto,
  MemberRolesQueryDto,
  MemberRolesResponseDto,
  OrganizationMembersQueryDto,
  OrganizationMembersResponseDto,
  ReplaceMemberRolesDto,
  ReplaceMemberRolesResponseDto,
} from './dto/organization-members.dto.js'
import { MemberService } from './member.service.js'
import { MemberAccessService } from './member-access/member-access.service.js'
import { CurrentMemberKeyActor, type MemberKeyActor } from './member-api-keys/member-key-actor.js'
import { MemberQueryService } from './member-query.service.js'
import { MemberRoleSetService } from './member-role-set.service.js'

/** Member writes retain the independently allowlisted API-key policy. */
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
    private readonly memberQuery: MemberQueryService,
    private readonly memberRoleSet: MemberRoleSetService,
    private readonly memberAccess: MemberAccessService
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
  @ApiQuery({
    name: 'roleId',
    required: false,
    type: String,
    description: 'Only members who hold this role; an unknown role matches nobody',
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
  @SchemaResponse({ type: OrganizationMembersResponseDto, status: 200 })
  list(
    @Param('orgId') orgId: string,
    @Query({ schema: OrganizationMembersQueryDto.schema }) query: OrganizationMembersQueryDto,
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
  @SchemaResponse({ type: MemberRolesResponseDto, status: 200 })
  roles(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Query({ schema: MemberRolesQueryDto.schema }) query: MemberRolesQueryDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<MemberRolesResponse> {
    return this.memberQuery.roles(orgId, userId, principal.organizationId, query)
  }

  @ApiParam({ name: 'orgId', description: 'Current organization membership selector' })
  @ApiParam({ name: 'userId', description: 'Target member user ID' })
  @ApiNotFoundResponse({ description: 'MEMBER_UNAVAILABLE' })
  @ApiServiceUnavailableResponse({
    description:
      'ROLE_ACCESS_UNAVAILABLE: over a loading or size limit, or a stored rule is not valid; no partial answer',
  })
  @Get(':userId/access')
  @Auth(AuthType.Bearer)
  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @ApiOperation({
    summary:
      "Explain a member's effective access in this organization; full TeamAccess and membership required",
    description:
      'Items are of three kinds: `record` (exact decision for the organization row, built-in operations), `configured` (what the role settings configure by independent areas for other registered capabilities, never a proof for one record) and `notEvaluated` (a capability that opted out).',
  })
  @SchemaResponse({ type: MemberAccessResponseDto, status: 200 })
  access(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<MemberAccess> {
    return this.memberAccess.explain(orgId, userId, principal.organizationId)
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
  @SchemaResponse({ type: ReplaceMemberRolesResponseDto, status: 200 })
  replace(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body({ schema: ReplaceMemberRolesDto.schema }) dto: ReplaceMemberRolesDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<ReplaceMemberRolesResponse> {
    return this.memberRoleSet.replace(orgId, userId, dto, principal)
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({
    summary: 'Remove a member and permanently revoke their organization API keys',
    description:
      'Requires full TeamAccess. Atomically destroys key verifiers, records audit, removes membership and advances ACL. Rejoining never restores old keys. At most1000 unrevoked keys;1001 refuses without changes. An unconfirmed outcome requires inspection, never automatic replay. Existing bearer/API-key policy and original-bound live SUPER_ADMIN exception remain unchanged.',
  })
  @ApiParam({ name: 'orgId', description: 'Target organization ID' })
  @ApiParam({ name: 'userId', description: 'Target member user ID' })
  @ApiQuery({
    name: 'expectedMemberId',
    required: false,
    type: String,
    description:
      'Optional membership identity precondition. Mismatch refuses without effects. Omission retains legacy current-target deletion; browser removal requires this value.',
  })
  @ApiNoContentResponse({ description: 'Member removed; organization keys irreversibly revoked' })
  @ApiBadRequestResponse({
    description:
      'BUSINESS_RULE_VIOLATION: last builtin administrator cannot be removed; invalid query returns validation error',
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND: member absent from the organization' })
  @ApiConflictResponse({
    description:
      'MEMBER_ROLES_CONFLICT: membership identity changed; MEMBER_API_KEYS_LIMIT: more than1000 unrevoked keys, no changes; MEMBER_API_KEYS_CONFLICT: concurrent write aborted',
  })
  @ApiServiceUnavailableResponse({
    description:
      'MEMBER_API_KEYS_WRITE_UNAVAILABLE: outcome may be unknown; inspect membership and keys before any fresh request',
  })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  removeMember(
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @CurrentMemberKeyActor() actor: MemberKeyActor,
    @Query({ schema: MemberRemovalQueryDto.schema }) query: MemberRemovalQueryDto
  ): Promise<void> {
    return this.memberService.removeMember(orgId, targetUserId, actor, query.expectedMemberId)
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
