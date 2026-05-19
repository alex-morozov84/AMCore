import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodSerializerDto } from 'nestjs-zod'

import {
  Action,
  AuthType,
  type InviteResponse,
  type RequestPrincipal,
  Subject,
} from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { CheckPolicies } from '../auth/decorators/check-policies.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import { CreateInviteDto, InviteResponseDto } from './dto'
import { InviteService } from './invite.service'
import { MemberService } from './member.service'

/**
 * Class-level `@Auth(AuthType.Bearer, AuthType.ApiKey)` is an explicit
 * dual-auth opt-in registered in ADR-034's allowlist. API keys may
 * invite/remove/assign roles within their bound organization subject to
 * the CASL `userPerms ∩ scopes` model; the per-handler `@CheckPolicies`
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
 */
@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations/:orgId/members')
@Auth(AuthType.Bearer, AuthType.ApiKey)
export class MembersController {
  constructor(
    private readonly memberService: MemberService,
    private readonly inviteService: InviteService
  ) {}

  @Post('invite')
  @HttpCode(HttpStatus.ACCEPTED)
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ZodSerializerDto(InviteResponseDto)
  @ApiOperation({
    summary:
      'Invite a user by email — ADMIN only. Returns a uniform 202 ' +
      '{status:"invited"} regardless of whether the email already has an ' +
      'account, is already a member, or is unknown. The pending invite is ' +
      'attached to a membership when the recipient calls ' +
      'POST /auth/invites/accept with the token from the invite email.',
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
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Remove a member from the organization — ADMIN only' })
  removeMember(
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<void> {
    return this.memberService.removeMember(orgId, targetUserId, principal)
  }

  @Post(':userId/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Assign a role to a member — ADMIN only' })
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
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Remove a role from a member — ADMIN only' })
  removeRole(
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<void> {
    return this.memberService.removeRole(orgId, targetUserId, roleId, principal)
  }
}
