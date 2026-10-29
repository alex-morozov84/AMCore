import { Body, Controller, Post, Req } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
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
  mfaSettingsStartInputSchema,
  mfaSettingsStartLookupSchema,
  mfaSettingsStartResultSchema,
  mfaSettingsStartStatusSchema,
} from '@amcore/shared'

import { AppException, ForbiddenException } from '../../common/exceptions/index.js'
import { createSchemaDto } from '../../common/schemas/schema-dto.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { resolveVerifiedVisitorIp } from '../../common/utils/verified-visitor-ip.js'
import { EnvService } from '../../env/env.service.js'
import { browserSessionContext } from '../frontend-context/browser-session-context.service.js'

import { Auth } from './decorators/auth.decorator.js'
import { MfaFlowStatusService } from './mfa/mfa-flow-status.service.js'
import { MfaSessionFlowService } from './mfa/mfa-session-flow.service.js'
import { MfaSettingsStartRecoveryService } from './mfa/mfa-settings-start-recovery.service.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from './organization-context/request-context-policy.js'

class StartInput extends createSchemaDto(mfaSettingsStartInputSchema) {}
class LookupInput extends createSchemaDto(mfaSettingsStartLookupSchema) {}
const StartResult = createSchemaDto(mfaSettingsStartResultSchema, 'MfaSettingsStartResult')
const StatusResult = createSchemaDto(mfaSettingsStartStatusSchema, 'MfaSettingsStartStatus')

function source(req: Request): {
  binding: NonNullable<NonNullable<ReturnType<typeof browserSessionContext>>['binding']>
  token: string
} {
  if (Object.keys(req.query ?? {}).length)
    throw new AppException('Unexpected query', 400, 'VALIDATION_ERROR')
  if (
    Object.keys(req.headers).some(
      (name) =>
        ['cookie', 'x-api-key', 'x-mfa-continuation'].includes(name) ||
        name.startsWith('x-invitation-')
    )
  )
    throw new ForbiddenException('Mixed source authority')
  const binding = browserSessionContext(req)?.binding
  const token = /^Bearer ([^\s]+)$/i.exec(String(req.headers.authorization ?? ''))?.[1]
  if (!binding || !token) throw new ForbiddenException('Original browser source required')
  return { binding, token }
}

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/mfa/settings-start')
@Auth(AuthType.Bearer)
@OrganizationContextBoundary({ apiRoots: [] })
@ApiBadRequestResponse({ description: 'Invalid strict operation or dispatch deadline' })
@ApiUnauthorizedResponse({ description: 'Original source session is invalid' })
@ApiForbiddenResponse({ description: 'Browser binding required; mixed credentials refused' })
@ApiConflictResponse({ description: 'Original source or operation tuple changed' })
@ApiTooManyRequestsResponse({ description: 'Source/start request budget exceeded' })
@ApiServiceUnavailableResponse({ description: 'Authority storage unavailable' })
export class MfaSettingsStartController {
  constructor(
    private readonly flows: MfaSessionFlowService,
    private readonly statuses: MfaFlowStatusService,
    private readonly recovery: MfaSettingsStartRecoveryService,
    private readonly env: EnvService
  ) {}

  @Post()
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Start one source-bound settings operation with an atomic start receipt',
  })
  @SchemaResponse({ type: StartResult, status: 200 })
  async start(
    @Body({ schema: StartInput.schema }) body: StartInput,
    @Req() req: Request
  ): Promise<z.infer<typeof mfaSettingsStartResultSchema>> {
    const { token, binding } = source(req)
    const result = await this.flows.start(
      token,
      binding,
      body.purpose,
      body.operationId,
      resolveVerifiedVisitorIp(req, this.env) ?? req.ip ?? req.socket?.remoteAddress ?? '',
      undefined,
      body
    )
    if (result.kind === 'recorded') return result.status
    if (result.kind !== 'flow') return result
    const status = await this.statuses.read(result.request)
    return {
      ...status,
      continuation: result.request.credential,
      purpose: body.purpose,
      expiresAt: result.expiresAt.toISOString(),
      requiredProofs: status.requiredProofs,
      nextAction: status.requiredProofs.length ? 'verify' : 'complete',
      browser: { contextId: binding.contextId, generation: binding.generation },
    }
  }

  @Post('status')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Read only the original settings-start outcome; never recover a continuation',
  })
  @SchemaResponse({ type: StatusResult, status: 200 })
  status(
    @Body({ schema: LookupInput.schema }) body: LookupInput,
    @Req() req: Request
  ): ReturnType<MfaSettingsStartRecoveryService['resolve']> {
    const { token, binding } = source(req)
    return this.recovery.resolve(token, binding, body, false)
  }

  @Post('abandon')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({ summary: 'Retire an unprogressed settings start or fence its delayed creation' })
  @SchemaResponse({ type: StatusResult, status: 200 })
  abandon(
    @Body({ schema: LookupInput.schema }) body: LookupInput,
    @Req() req: Request
  ): ReturnType<MfaSettingsStartRecoveryService['resolve']> {
    const { token, binding } = source(req)
    return this.recovery.resolve(token, binding, body, true)
  }
}
