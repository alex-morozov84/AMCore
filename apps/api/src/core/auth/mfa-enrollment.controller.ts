import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
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
import type { Request } from 'express'
import type { z } from 'zod'

import {
  AuthType,
  mfaCodesAcknowledgementInputSchema,
  mfaCodesAcknowledgementResultSchema,
  mfaEnrollmentInputSchema,
  mfaEnrollmentResultSchema,
  mfaFactorBindingResultSchema,
  mfaOperationInputSchema,
  mfaRecoveryTicketInputSchema,
  mfaRecoveryTicketResultSchema,
  mfaSetupCodesResultSchema,
  mfaVerifyInputSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../common/schemas/schema-dto.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { resolveVerifiedVisitorIp } from '../../common/utils/verified-visitor-ip.js'
import { EnvService } from '../../env/env.service.js'

import { Auth } from './decorators/auth.decorator.js'
import { MfaBackupRotationService } from './mfa/mfa-backup-rotation.service.js'
import { continuationRequest, MfaContinuationGuard } from './mfa/mfa-continuation.guard.js'
import { MfaFactorBindingService } from './mfa/mfa-factor-binding.service.js'
import { MfaSeedDraftService } from './mfa/mfa-seed-draft.service.js'
import { MfaSetupAcknowledgementService } from './mfa/mfa-setup-acknowledgement.service.js'
import { MfaSetupCodeRecoveryService } from './mfa/mfa-setup-code-recovery.service.js'
import { MfaTicketRedemptionService } from './mfa/mfa-ticket-redemption.service.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from './organization-context/request-context-policy.js'

class EnrollmentInput extends createSchemaDto(mfaEnrollmentInputSchema) {}
const EnrollmentResult = createSchemaDto(mfaEnrollmentResultSchema, 'MfaEnrollmentResult')
class FactorInput extends createSchemaDto(mfaVerifyInputSchema) {}
const FactorResult = createSchemaDto(mfaFactorBindingResultSchema, 'MfaFactorResult')
class AcknowledgementInput extends createSchemaDto(mfaCodesAcknowledgementInputSchema) {}
const AcknowledgementResult = createSchemaDto(
  mfaCodesAcknowledgementResultSchema,
  'MfaAcknowledgementResult'
)
const CodesResult = createSchemaDto(mfaSetupCodesResultSchema, 'MfaCodesResult')
class RotationInput extends createSchemaDto(mfaOperationInputSchema) {}
class TicketInput extends createSchemaDto(mfaRecoveryTicketInputSchema) {}
const TicketResult = createSchemaDto(mfaRecoveryTicketResultSchema, 'MfaTicketResult')

@ApiTags('auth')
@ApiConsumes('application/json')
@ApiHeader({
  name: 'X-Mfa-Continuation',
  required: true,
  description: 'Own restricted flow capability; never ordinary authorization',
})
@ApiBadRequestResponse({ description: 'Invalid strict command or unexpected query' })
@ApiForbiddenResponse({ description: 'Mixed credentials or invalid private browser transport' })
@ApiUnauthorizedResponse({ description: 'Continuation or browser context changed' })
@ApiTooManyRequestsResponse({ description: 'Source or global attempt budget exceeded' })
@ApiServiceUnavailableResponse({ description: 'Unknown outcome; do not replay a code or mutation' })
@Controller('auth/mfa')
@Auth(AuthType.None)
@OrganizationContextBoundary({ apiRoots: [] })
@UseGuards(MfaContinuationGuard)
export class MfaEnrollmentController {
  constructor(
    private readonly rotation: MfaBackupRotationService,
    private readonly drafts: MfaSeedDraftService,
    private readonly binding: MfaFactorBindingService,
    private readonly acknowledgements: MfaSetupAcknowledgementService,
    private readonly codes: MfaSetupCodeRecoveryService,
    private readonly tickets: MfaTicketRedemptionService,
    private readonly env: EnvService
  ) {}

  @Post('enrollment')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({ summary: 'Open only this unbound seed draft; grant no ordinary session' })
  @SchemaResponse({ type: EnrollmentResult, status: 200 })
  async enrollment(
    @Body({ schema: EnrollmentInput.schema }) body: EnrollmentInput,
    @Req() req: Request
  ): Promise<z.infer<typeof mfaEnrollmentResultSchema>> {
    const result = await this.drafts.open(
      continuationRequest(req, body.purpose),
      body.operationId,
      body.regenerate,
      this.source(req)
    )
    return result.outcome === 'seed'
      ? {
          outcome: 'seed',
          enrollment: { secret: result.secret, otpauthUri: result.otpauthUri },
          expiresAt: result.expiresAt.toISOString(),
        }
      : result
  }

  @Post('bind-factor')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary:
      'Bind a new app with its unused TOTP; return its one-time restricted successor and backup set',
  })
  @SchemaResponse({ type: FactorResult, status: 200 })
  async bind(
    @Body({ schema: FactorInput.schema }) body: FactorInput,
    @Req() req: Request
  ): Promise<z.infer<typeof mfaFactorBindingResultSchema>> {
    const result = await this.binding.bind(
      continuationRequest(req, body.purpose),
      body.operationId,
      body.proof,
      this.source(req)
    )
    if (result.outcome !== 'bound') return result
    const successor = result.successor
    return {
      outcome: 'bound',
      successor: {
        continuation: successor.request.credential,
        purpose: 'initial_setup',
        browser: successor.request.browser
          ? {
              contextId: successor.request.browser.contextId,
              generation: successor.request.browser.generation,
            }
          : null,
        expiresAt: successor.expiresAt.toISOString(),
        backupCodes: { codes: successor.codes, generation: successor.generation },
      },
    }
  }

  @Post('acknowledge-codes')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary:
      'Acknowledge the exact saved backup generation; issue no credentials or plaintext codes',
  })
  @SchemaResponse({ type: AcknowledgementResult, status: 200 })
  acknowledge(
    @Body({ schema: AcknowledgementInput.schema }) body: AcknowledgementInput,
    @Req() req: Request
  ): Promise<z.infer<typeof mfaCodesAcknowledgementResultSchema>> {
    return this.acknowledgements.acknowledge(
      continuationRequest(req, body.purpose),
      body.operationId,
      body.generation,
      this.source(req)
    )
  }

  @Post('rotate-codes')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Replace backup codes using fresh proof on the original family; return plaintext once',
  })
  @SchemaResponse({ type: CodesResult, status: 200 })
  async rotate(
    @Body({ schema: RotationInput.schema }) body: RotationInput,
    @Req() req: Request
  ): Promise<z.infer<typeof mfaSetupCodesResultSchema>> {
    const result = await this.rotation.rotate(
      continuationRequest(req, body.purpose),
      body.operationId,
      this.source(req)
    )
    return result.outcome === 'codes'
      ? { outcome: 'codes', backupCodes: { codes: result.codes, generation: result.generation } }
      : result
  }

  @Post('recover-setup-codes')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary:
      'Replace a lost first-setup backup set with a new unused app code; never redisplay an old set',
  })
  @SchemaResponse({ type: CodesResult, status: 200 })
  async recover(
    @Body({ schema: FactorInput.schema }) body: FactorInput,
    @Req() req: Request
  ): Promise<z.infer<typeof mfaSetupCodesResultSchema>> {
    const result = await this.codes.recover(
      continuationRequest(req, body.purpose),
      body.operationId,
      body.proof,
      this.source(req)
    )
    return result.outcome === 'codes'
      ? { outcome: 'codes', backupCodes: { codes: result.codes, generation: result.generation } }
      : result
  }

  @Post('redeem-recovery-ticket')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary:
      'Consume an administrator recovery ticket with a fresh local password; grant only new-app enrollment',
  })
  @SchemaResponse({ type: TicketResult, status: 200 })
  async redeem(
    @Body({ schema: TicketInput.schema }) body: TicketInput,
    @Req() req: Request
  ): Promise<z.infer<typeof mfaRecoveryTicketResultSchema>> {
    const result = await this.tickets.redeem(
      continuationRequest(req, body.purpose),
      body.operationId,
      body.password,
      body.ticket,
      this.source(req)
    )
    if (result.outcome !== 'enrollment') return result
    return {
      outcome: 'enrollment',
      successor: {
        continuation: result.request.credential,
        purpose: 'initial_setup',
        expiresAt: result.expiresAt.toISOString(),
        browser: result.request.browser
          ? {
              contextId: result.request.browser.contextId,
              generation: result.request.browser.generation,
            }
          : null,
      },
    }
  }

  private source(req: Request): string {
    return resolveVerifiedVisitorIp(req, this.env) ?? req.ip ?? req.socket?.remoteAddress ?? ''
  }
}
