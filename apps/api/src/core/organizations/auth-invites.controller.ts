import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'

import { type AcceptInviteInput, AuthType, type RequestPrincipal } from '@amcore/shared'

import { ApiProtectionUnavailable } from '../../common/exceptions/index.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { getClientIp } from '../../common/utils/anonymize-ip.js'
import { Auth } from '../auth/decorators/auth.decorator.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy.js'
import { ApiFrontendContext } from '../frontend-context/frontend-context.openapi.js'
import { InvitationContinuationService } from '../invitations/invitation-continuation.service.js'
import { InvitationRequestGuard } from '../invitations/invitation-request.guard.js'

import { AcceptInviteDto, AcceptInviteResponseDto } from './dto/index.js'
import {
  InvitationAdmissionDto,
  InvitationInspectDto,
  InvitationOperationDto,
} from './dto/invitation-recipient.dto.js'
import { parseInvitationOperationId } from './invitation-operation.js'
import { InviteAcceptService } from './invite-accept.service.js'

@ApiFrontendContext()
@ApiTags('auth')
@ApiBearerAuth()
@ApiBadRequestResponse({ description: 'Invalid/expired invitation or account mismatch' })
@ApiUnauthorizedResponse({
  description: 'Current personal bearer session required; pending handoff denied',
})
@ApiForbiddenResponse({ description: 'Email verification required' })
@ApiConflictResponse({ description: 'Operation intent conflict or aged operation ID' })
@ApiTooManyRequestsResponse({ description: 'Invitation attempts limited' })
@ApiServiceUnavailableResponse({
  description: 'Read unavailable or write unconfirmed; recover by operation ID',
})
@Controller('auth/invites')
@Auth(AuthType.Bearer)
@OrganizationContextBoundary({ apiRoots: [] })
@UseGuards(InvitationRequestGuard)
export class AuthInvitesController {
  constructor(
    private readonly acceptance: InviteAcceptService,
    private readonly continuation: InvitationContinuationService
  ) {}

  @RequestContextPolicy({ kind: 'personal' })
  @Post('inspect')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Inspect an invitation for the matching account; verified consent reveals stable intent',
  })
  @SchemaResponse({ type: InvitationInspectDto, status: 200 })
  inspect(
    @Body({ schema: InvitationAdmissionDto.schema }) dto: InvitationAdmissionDto,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<InvitationContinuationService['inspect']> {
    return this.continuation.inspect({ token: dto.token }, principal)
  }

  @RequestContextPolicy({ kind: 'personal' })
  @Post('continuations/inspect')
  @HttpCode(200)
  @ApiHeader({
    name: 'X-Invitation-Continuation',
    required: true,
    description: 'Scoped continuation secret',
  })
  @ApiOperation({ summary: 'Inspect a current scoped continuation for the matching account' })
  @SchemaResponse({ type: InvitationInspectDto, status: 200 })
  inspectContinuation(
    @Headers('x-invitation-continuation') credential: string,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<InvitationContinuationService['inspect']> {
    return this.continuation.inspect({ continuation: credential }, principal)
  }

  @RequestContextPolicy({ kind: 'personal' })
  @Post('accept')
  @ApiBody({ type: AcceptInviteDto })
  @HttpCode(200)
  @ApiHeader({
    name: 'X-Invitation-Operation-Id',
    required: true,
    description: 'UUIDv7 stable operation ID',
  })
  @ApiHeader({
    name: 'X-Invitation-Continuation',
    required: false,
    description: 'Required for continuation:true carrier',
  })
  @ApiOperation({
    summary:
      'Explicitly accept the inspected intent; same operation replays without granting twice',
  })
  @SchemaResponse({ type: AcceptInviteResponseDto, status: 200 })
  @ApiProtectionUnavailable('invitation')
  accept(
    @Body({ schema: AcceptInviteDto.schema }) dto: AcceptInviteInput,
    @CurrentUser() principal: RequestPrincipal,
    @Headers('x-invitation-operation-id') operation: string,
    @Headers('x-invitation-continuation') credential: string,
    @Req() req: Request
  ): ReturnType<InviteAcceptService['accept']> {
    const intent = {
      expectedInviteId: dto.expectedInviteId,
      expectedGeneration: dto.expectedGeneration,
    }
    return this.acceptance.accept(
      'token' in dto ? { token: dto.token } : { continuation: credential },
      intent,
      parseInvitationOperationId(operation),
      principal,
      getClientIp(req) ?? 'unknown'
    )
  }

  @RequestContextPolicy({ kind: 'personal' })
  @Get('operations/:operationId')
  @ApiParam({ name: 'operationId', type: String })
  @ApiOperation({
    summary:
      'Recover own acceptance proof without invitation credential; access may have been removed',
  })
  @SchemaResponse({ type: InvitationOperationDto, status: 200 })
  operation(
    @Param('operationId') id: string,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<InviteAcceptService['operation']> {
    return this.acceptance.operation(id, principal)
  }
}
