import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { ZodSerializerDto } from 'nestjs-zod'

import {
  Action,
  AuthType,
  type InviteListResponse,
  PAGINATION,
  type RequestPrincipal,
  Subject,
} from '@amcore/shared'

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto'
import { Auth } from '../auth/decorators/auth.decorator'
import { CheckPolicies } from '../auth/decorators/check-policies.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import { InviteListResponseDto } from './dto'
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
 * flip; narrowing it is a separate decision. See
 * `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OB-02.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations/:orgId/invites')
@Auth(AuthType.Bearer)
export class InvitesController {
  constructor(private readonly inviteService: InviteService) {}

  @Get()
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({
    summary: 'List active pending invites for the organization — ADMIN only',
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
  @ZodSerializerDto(InviteListResponseDto)
  listInvites(
    @Param('orgId') orgId: string,
    @CurrentUser() principal: RequestPrincipal,
    @Query() pagination: PaginationQueryDto
  ): Promise<InviteListResponse> {
    return this.inviteService.listInvites(orgId, principal, pagination.page, pagination.limit)
  }

  @Delete(':inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({
    summary:
      'Revoke a pending invite — ADMIN only. Idempotent: revoking an ' +
      'already-revoked invite returns 204. Revoking an accepted invite ' +
      'returns 400 BUSINESS_RULE_VIOLATION (remove the member via ' +
      'DELETE /organizations/:orgId/members/:userId instead).',
  })
  revokeInvite(
    @Param('orgId') orgId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<void> {
    return this.inviteService.revokeInvite(orgId, inviteId, principal)
  }
}
