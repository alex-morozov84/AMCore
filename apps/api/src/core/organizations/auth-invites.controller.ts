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
import { ZodResponse, ZodValidationPipe } from 'nestjs-zod'

import { type AcceptInviteInput, AuthType, type RequestPrincipal } from '@amcore/shared'

import { getClientIp } from '../../common/utils/anonymize-ip'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'
import { InvitationContinuationService } from '../invitations/invitation-continuation.service'
import { InvitationRequestGuard } from '../invitations/invitation-request.guard'

import { AcceptInviteDto, AcceptInviteResponseDto } from './dto'
import {
  InvitationAdmissionDto,
  InvitationInspectDto,
  InvitationOperationDto,
} from './dto/invitation-recipient.dto'
import { parseInvitationOperationId } from './invitation-operation'
import { InviteAcceptService } from './invite-accept.service'

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
  @ZodResponse({ type: InvitationInspectDto, status: 200 })
  inspect(
    @Body() dto: InvitationAdmissionDto,
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
  @ZodResponse({ type: InvitationInspectDto, status: 200 })
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
  @ZodResponse({ type: AcceptInviteResponseDto, status: 200 })
  accept(
    @Body(new ZodValidationPipe(AcceptInviteDto)) dto: AcceptInviteInput,
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
  @ZodResponse({ type: InvitationOperationDto, status: 200 })
  operation(
    @Param('operationId') id: string,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<InviteAcceptService['operation']> {
    return this.acceptance.operation(id, principal)
  }
}
