import { Controller, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'

import {
  AuthType,
  invitationHandoffAbortedSchema,
  invitationHandoffConfirmedSchema,
  type RequestPrincipal,
} from '@amcore/shared'

import { createSchemaDto } from '../../common/schemas/schema-dto.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { RateLimit } from '../../infrastructure/throttling/index.js'
import { invitationHandoffProof } from '../invitations/invitation-auth-handoff.js'
import { InvitationAuthHandoffService } from '../invitations/invitation-auth-handoff.service.js'
import { InvitationRequestGuard } from '../invitations/invitation-request.guard.js'

import { Auth } from './decorators/auth.decorator.js'
import { CurrentUser } from './decorators/current-user.decorator.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from './organization-context/request-context-policy.js'

class HandoffConfirmedDto extends createSchemaDto(invitationHandoffConfirmedSchema) {}
class HandoffAbortedDto extends createSchemaDto(invitationHandoffAbortedSchema) {}

@ApiTags('auth')
@ApiHeader({
  name: 'X-Invitation-Handoff-Key',
  required: true,
  description: '256-bit cleanup key; server-held',
})
@ApiParam({ name: 'attemptId', type: String })
@ApiUnauthorizedResponse({ description: 'Invalid proof/session or expired unconfirmed handoff' })
@ApiConflictResponse({ description: 'Confirmed handoff cannot be aborted' })
@ApiTooManyRequestsResponse({ description: 'Handoff attempt budget exceeded' })
@ApiServiceUnavailableResponse({
  description: 'Confirmation/cleanup unconfirmed; deadline sweep remains active',
})
@Controller('auth/invites/auth-handoffs')
@Auth(AuthType.None)
@OrganizationContextBoundary({ apiRoots: [] })
@RateLimit({ rate: 60, per: 60000, burst: 60 })
@UseGuards(InvitationRequestGuard)
export class InvitationHandoffsController {
  constructor(private readonly handoffs: InvitationAuthHandoffService) {}

  @Post(':attemptId/confirm')
  @HttpCode(200)
  @Auth(AuthType.Bearer)
  @ApiBearerAuth()
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Confirm the exact newly published backend session; repeated confirmation is safe',
  })
  @SchemaResponse({ type: HandoffConfirmedDto, status: 200 })
  confirm(
    @Param('attemptId') attempt: string,
    @Headers('x-invitation-handoff-key') key: string,
    @CurrentUser() actor: RequestPrincipal
  ): Promise<{ status: 'confirmed' }> {
    return this.handoffs.settle(invitationHandoffProof(attempt, key)!, 'confirm', actor)
  }

  @Post(':attemptId/abort')
  @HttpCode(200)
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Abort only the tagged unconfirmed session; never revoke a prior or confirmed session',
  })
  @SchemaResponse({ type: HandoffAbortedDto, status: 200 })
  abort(
    @Param('attemptId') attempt: string,
    @Headers('x-invitation-handoff-key') key: string
  ): Promise<{ status: 'aborted' }> {
    return this.handoffs.settle(invitationHandoffProof(attempt, key)!, 'abort')
  }
}
