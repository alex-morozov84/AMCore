import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { OrgMember } from '@prisma/client'

import { Action, type RequestPrincipal, Subject } from '@amcore/shared'

import { CheckPolicies } from '../auth/decorators/check-policies.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import { InviteMemberDto } from './dto'
import { MemberService } from './member.service'

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations/:orgId/members')
export class MembersController {
  constructor(private readonly memberService: MemberService) {}

  @Post('invite')
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Add a user to the organization by email — ADMIN only' })
  invite(
    @Param('orgId') orgId: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<OrgMember> {
    return this.memberService.invite(orgId, dto, principal)
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
