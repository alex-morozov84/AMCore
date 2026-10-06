import { Body, Controller, Headers, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { ZodResponse } from 'nestjs-zod'

import { AuthType } from '@amcore/shared'

import { resolveSessionIpAddress } from '../../common/utils/verified-visitor-ip'
import { EnvService } from '../../env/env.service'
import { RateLimit } from '../../infrastructure/throttling'
import { AuthService } from '../auth/auth.service'
import { Auth } from '../auth/decorators/auth.decorator'
import { AuthResponseDto } from '../auth/dto'
import { negotiateLocale } from '../auth/locale-negotiation'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'
import { invitationHandoffProof } from '../invitations/invitation-auth-handoff'
import { InvitationContinuationService } from '../invitations/invitation-continuation.service'
import { InvitationRequestGuard } from '../invitations/invitation-request.guard'

import {
  InvitationAdmissionDto,
  InvitationAdmissionResponseDto,
  InvitationContextDto,
  InvitedRegisterDto,
} from './dto/invitation-recipient.dto'

@ApiTags('auth')
@ApiBadRequestResponse({ description: 'Invalid, expired or superseded invitation' })
@ApiConflictResponse({ description: 'Existing account or authentication attempt' })
@ApiForbiddenResponse({ description: 'Signup policy denied' })
@ApiTooManyRequestsResponse({ description: 'Invitation admission/registration budget exceeded' })
@ApiServiceUnavailableResponse({ description: 'Invitation authority unavailable' })
@Controller('auth/invites')
@Auth(AuthType.None)
@OrganizationContextBoundary({ apiRoots: [] })
@UseGuards(InvitationRequestGuard)
export class InvitationPublicController {
  constructor(
    private readonly continuation: InvitationContinuationService,
    private readonly auth: AuthService,
    private readonly env: EnvService
  ) {}

  @Post('continuations')
  @RequestContextPolicy({ kind: 'personal' })
  @RateLimit({ rate: 20, per: 60000, burst: 20 })
  @ApiOperation({
    summary:
      'Admit a current invitation into a30-minute scoped continuation; no account/access mutation',
  })
  @ZodResponse({ type: InvitationAdmissionResponseDto, status: 201 })
  admit(@Body() dto: InvitationAdmissionDto): ReturnType<InvitationContinuationService['admit']> {
    return this.continuation.admit(dto.token)
  }

  @Post('continuations/context')
  @HttpCode(200)
  @RequestContextPolicy({ kind: 'personal' })
  @ApiHeader({ name: 'X-Invitation-Continuation', required: true })
  @ApiOperation({
    summary: 'Read fixed signup email for a valid bearer continuation; no account existence',
  })
  @ZodResponse({ type: InvitationContextDto, status: 200 })
  context(
    @Headers('x-invitation-continuation') credential: string
  ): ReturnType<InvitationContinuationService['context']> {
    return this.continuation.context(credential)
  }

  @Post('register')
  @RequestContextPolicy({ kind: 'personal' })
  @RateLimit({ rate: 5, per: 3600000, burst: 5 })
  @ApiHeader({ name: 'X-Invitation-Continuation', required: true })
  @ApiHeader({ name: 'X-Invitation-Auth-Attempt-Id', required: false })
  @ApiHeader({ name: 'X-Invitation-Handoff-Key', required: false })
  @ApiOperation({
    summary: 'Create an unverified ordinary account for the fixed invitation email; never join',
  })
  @ZodResponse({ type: AuthResponseDto, status: 201 })
  async register(
    @Body() dto: InvitedRegisterDto,
    @Headers('x-invitation-continuation') credential: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<Omit<Awaited<ReturnType<AuthService['registerInvited']>>, 'refreshToken'>> {
    const result = await this.auth.registerInvited(dto, credential, {
      handoff: invitationHandoffProof(
        req.headers['x-invitation-auth-attempt-id'],
        req.headers['x-invitation-handoff-key']
      ),
      userAgent: req.headers['user-agent'],
      ipAddress: resolveSessionIpAddress(req, this.env),
      acceptedLocale: negotiateLocale(req),
    })
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: this.env.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 86400000,
    })
    return { user: result.user, accessToken: result.accessToken }
  }
}
