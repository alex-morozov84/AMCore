import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { z } from 'zod'

import {
  AuthType,
  mfaCompleteInputSchema,
  mfaIssuanceOutcomeSchema,
  mfaOperationInputSchema,
  mfaPasswordInputSchema,
  mfaPasswordResultSchema,
  mfaPurposeSchema,
  mfaReauthenticationResultSchema,
  type MfaStatus,
  mfaStatusSchema,
  mfaVerificationResultSchema,
  mfaVerifyInputSchema,
  type PasswordLoginResponse,
} from '@amcore/shared'

import { createSchemaDto } from '../../common/schemas/schema-dto.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { SchemaResponses } from '../../common/schemas/schema-responses.js'
import {
  resolveSessionIpAddress,
  resolveVerifiedVisitorIp,
} from '../../common/utils/verified-visitor-ip.js'
import { EnvService } from '../../env/env.service.js'

import { Auth } from './decorators/auth.decorator.js'
import { PasswordLoginResponseDto } from './dto/index.js'
import { continuationRequest, MfaContinuationGuard } from './mfa/mfa-continuation.guard.js'
import { MfaFamilyReauthenticationService } from './mfa/mfa-family-reauthentication.service.js'
import { MfaFlowStatusService } from './mfa/mfa-flow-status.service.js'
import {
  type FlowVerification,
  MfaFlowVerificationService,
} from './mfa/mfa-flow-verification.service.js'
import {
  MfaPasswordVerificationService,
  type PrimaryVerification,
} from './mfa/mfa-password-verification.service.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from './organization-context/request-context-policy.js'
import { PasswordLoginService } from './password-login.service.js'

class ReauthenticateInput extends createSchemaDto(mfaOperationInputSchema) {}
const ReauthenticateResult = createSchemaDto(
  mfaReauthenticationResultSchema,
  'MfaReauthenticateResult'
)

class PasswordInput extends createSchemaDto(mfaPasswordInputSchema) {}
class PasswordResult extends createSchemaDto(mfaPasswordResultSchema) {}
class VerifyInput extends createSchemaDto(mfaVerifyInputSchema) {}
class VerifyResult extends createSchemaDto(mfaVerificationResultSchema) {}
class CompleteInput extends createSchemaDto(mfaCompleteInputSchema) {}
class StatusInput extends createSchemaDto(z.object({ purpose: mfaPurposeSchema }).strict()) {}
class StatusResult extends createSchemaDto(mfaStatusSchema) {}
const CompleteOutcome = createSchemaDto(mfaIssuanceOutcomeSchema, 'MfaIssuanceOutcome')

@ApiTags('auth')
@ApiConsumes('application/json')
@ApiHeader({
  name: 'X-Mfa-Continuation',
  required: true,
  description: 'Own opaque flow capability; never a bearer token',
})
@ApiBadRequestResponse({ description: 'Invalid strict command or unexpected query' })
@ApiForbiddenResponse({ description: 'Mixed credentials or invalid private browser transport' })
@ApiUnauthorizedResponse({ description: 'Invalid continuation or changed browser context' })
@ApiTooManyRequestsResponse({ description: 'Source/global budget exceeded' })
@ApiServiceUnavailableResponse({
  description: 'Proof or storage unavailable; do not infer completion',
})
@Controller('auth/mfa')
@Auth(AuthType.None)
@OrganizationContextBoundary({ apiRoots: [] })
@UseGuards(MfaContinuationGuard)
export class MfaLoginController {
  constructor(
    private readonly reauthentication: MfaFamilyReauthenticationService,
    private readonly passwords: MfaPasswordVerificationService,
    private readonly statuses: MfaFlowStatusService,
    private readonly factors: MfaFlowVerificationService,
    private readonly login: PasswordLoginService,
    private readonly env: EnvService
  ) {}

  @Post('reauthenticate')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Commit fresh proofs only to the exact original family; issue no credentials',
  })
  @SchemaResponse({ type: ReauthenticateResult, status: 200 })
  reauthenticate(
    @Body({ schema: ReauthenticateInput.schema }) body: ReauthenticateInput,
    @Req() req: Request
  ): Promise<z.infer<typeof mfaReauthenticationResultSchema>> {
    return this.reauthentication.complete(continuationRequest(req, body.purpose), body.operationId)
  }

  @Post('status')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Read only this live flow status; never repeat a mutation or redisplay secrets',
  })
  @SchemaResponse({ type: StatusResult, status: 200 })
  status(
    @Body({ schema: StatusInput.schema }) body: StatusInput,
    @Req() req: Request
  ): Promise<MfaStatus> {
    return this.statuses.read(continuationRequest(req, body.purpose))
  }

  @Post('password')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Verify the local password for this exact continuation; issue no session or token',
  })
  @SchemaResponse({ type: PasswordResult, status: 200 })
  password(
    @Body({ schema: PasswordInput.schema }) body: PasswordInput,
    @Req() req: Request
  ): Promise<PrimaryVerification> {
    return this.passwords.submit(
      continuationRequest(req, body.purpose),
      body.operationId,
      body.password,
      resolveVerifiedVisitorIp(req, this.env) ?? req.ip ?? req.socket?.remoteAddress ?? ''
    )
  }

  @Post('verify')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Verify one TOTP or unused backup code for the exact flow; issue no credentials',
  })
  @SchemaResponse({ type: VerifyResult, status: 200 })
  verify(
    @Body({ schema: VerifyInput.schema }) body: VerifyInput,
    @Req() req: Request
  ): Promise<FlowVerification> {
    return this.factors.submit(
      continuationRequest(req, body.purpose),
      body.operationId,
      body.proof,
      resolveVerifiedVisitorIp(req, this.env) ?? req.ip ?? req.socket?.remoteAddress ?? ''
    )
  }

  @Post('complete')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary:
      'Issue credentials once from committed proofs; pending publication grants no normal access',
  })
  @SchemaResponses(
    {
      type: PasswordLoginResponseDto,
      status: 200,
      description: 'Winning credential response; retain and acknowledge its publication if present',
    },
    {
      type: CompleteOutcome,
      status: 202,
      description: 'Nonsecret proof requirement or prior issuance status; no credential replay',
    }
  )
  async complete(
    @Body({ schema: CompleteInput.schema }) body: CompleteInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<PasswordLoginResponse | z.infer<typeof mfaIssuanceOutcomeSchema>> {
    const result = await this.login.complete(
      continuationRequest(req, body.purpose),
      body.operationId,
      {
        vaultBinding: body.vaultBinding,
        userAgent: req.headers['user-agent'],
        ipAddress: resolveSessionIpAddress(req, this.env),
      }
    )
    if (result.kind !== 'complete') {
      res.status(202)
      return result
    }
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: this.env.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * ('raw' in res ? 1 : 1000),
    })
    return result.body
  }
}
