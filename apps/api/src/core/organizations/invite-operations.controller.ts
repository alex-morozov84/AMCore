import { Controller, Get, Param } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import { AuthType, ORGANIZATION_CONTEXT_FAMILY } from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'

import { ManagerInviteOperationResponseDto } from './dto/invitation-management.dto'
import { CurrentInvitationActor, type InvitationActor } from './invitation-actor'
import { InviteService } from './invite.service'

@ApiTags('organizations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer required' })
@ApiForbiddenResponse({ description: 'Current actual membership and full TeamAccess required' })
@ApiBadRequestResponse({ description: 'Invalid UUIDv7 operation ID' })
@ApiServiceUnavailableResponse({ description: 'Operation proof unavailable' })
@Controller('organizations/:orgId/invite-operations')
@Auth(AuthType.Bearer)
@OrganizationContextBoundary(ORGANIZATION_CONTEXT_FAMILY)
export class InviteOperationsController {
  constructor(private readonly invites: InviteService) {}

  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @Get(':operationId')
  @ApiParam({ name: 'orgId', type: String })
  @ApiParam({ name: 'operationId', type: String })
  @ApiOperation({
    summary: 'Recover an own committed invitation command; unknown is not rollback proof',
  })
  @ZodResponse({ type: ManagerInviteOperationResponseDto, status: 200 })
  operation(
    @Param('orgId') orgId: string,
    @Param('operationId') id: string,
    @CurrentInvitationActor() actor: InvitationActor
  ): ReturnType<InviteService['managerOperation']> {
    return this.invites.managerOperation(orgId, actor, id)
  }
}
