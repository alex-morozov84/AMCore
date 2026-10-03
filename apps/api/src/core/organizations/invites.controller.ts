import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import { ORGANIZATION_CONTEXT_FAMILY } from '@amcore/shared'
import {
  AuthType,
  type InviteListResponse,
  PAGINATION,
  type RequestPrincipal,
} from '@amcore/shared'

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'

import { InviteListResponseDto } from './dto'
import { CurrentInvitationActor, type InvitationActor } from './invitation-actor'
import { InviteService } from './invite.service'

/**
 * Pending-invite management for org admins (OB-02 Stage C).
 *
 * Class-level `@Auth(AuthType.Bearer)` — bearer-only. Listing or
 * revoking outstanding invites is an interactive admin action; adding
 * `AuthType.ApiKey` here would require both an ADR-034 amendment and a
 * matching per-handler entry in `auth-decorator-coverage.spec.ts`. The
 * invite-create route on `MembersController` stays dual-auth because
 * the credential matrix there was unchanged by the Stage C contract
 * flip; narrowing it is a separate decision (ADR-034).
 */
@ApiTags('organizations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid accepted credential' })
@ApiForbiddenResponse({
  description: 'FORBIDDEN: target, record/field or full TeamAccess authority denied',
})
@Controller('organizations/:orgId/invites')
@Auth(AuthType.Bearer)
@OrganizationContextBoundary(ORGANIZATION_CONTEXT_FAMILY)
export class InvitesController {
  constructor(private readonly inviteService: InviteService) {}

  @ApiParam({ name: 'orgId', type: String })
  @ApiBadRequestResponse({ description: 'Invalid query or selector' })
  @ApiNotFoundResponse({ description: 'Organization unavailable' })
  @Get()
  @RequireTeamAccess('orgId')
  @ApiOperation({
    summary: 'List active pending invites for the organization — requires full TeamAccess',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    minimum: 1,
    example: PAGINATION.DEFAULT_PAGE,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: PAGINATION.MAX_LIMIT,
    example: PAGINATION.DEFAULT_LIMIT,
  })
  @ZodResponse({
    type: InviteListResponseDto,
    status: 200,
    description: 'Paginated pending invites',
  })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  listInvites(
    @Param('orgId') orgId: string,
    @CurrentUser() principal: RequestPrincipal,
    @Query() pagination: PaginationQueryDto
  ): Promise<InviteListResponse> {
    return this.inviteService.listInvites(orgId, principal, pagination.page, pagination.limit)
  }

  @Delete(':inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTeamAccess('orgId')
  @ApiOperation({
    summary:
      'Revoke a pending invite — requires full TeamAccess. Idempotent: revoking an ' +
      'already-revoked invite returns 204. Revoking an accepted invite ' +
      'returns 400 BUSINESS_RULE_VIOLATION (remove the member via ' +
      'DELETE /organizations/:orgId/members/:userId instead).',
  })
  @ApiTooManyRequestsResponse({ description: 'Request rate limit exceeded' })
  @ApiNoContentResponse({ description: 'Invite revoked; repeat preserves first revocation' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'inviteId', type: String })
  @ApiBadRequestResponse({ description: 'BUSINESS_RULE_VIOLATION: already accepted' })
  @ApiNotFoundResponse({ description: 'Organization or invite unavailable' })
  @ApiConflictResponse({ description: 'CONFLICT: known transaction abort' })
  @ApiServiceUnavailableResponse({
    description: 'Write unconfirmed; inspect state before retrying',
  })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  revokeInvite(
    @Param('orgId') orgId: string,
    @Param('inviteId') inviteId: string,
    @CurrentInvitationActor() actor: InvitationActor
  ): Promise<void> {
    return this.inviteService.revokeInvite(orgId, inviteId, actor)
  }
}
