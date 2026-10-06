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
import { ZodResponse } from 'nestjs-zod'

import { ORGANIZATION_CONTEXT_FAMILY } from '@amcore/shared'
import {
  AuthType,
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

import {
  MemberRolesQueryDto,
  MemberRolesResponseDto,
  OrganizationMembersQueryDto,
  OrganizationMembersResponseDto,
  ReplaceMemberRolesDto,
  ReplaceMemberRolesResponseDto,
} from './dto/organization-members.dto'
import { MemberService } from './member.service'
import { MemberQueryService } from './member-query.service'
import { MemberRoleSetService } from './member-role-set.service'

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
