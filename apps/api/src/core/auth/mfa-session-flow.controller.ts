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

import { AuthType, mfaSessionFlowInputSchema, mfaSessionFlowResultSchema } from '@amcore/shared'

import { AppException, ForbiddenException } from '../../common/exceptions/index.js'
import { createSchemaDto } from '../../common/schemas/schema-dto.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { resolveVerifiedVisitorIp } from '../../common/utils/verified-visitor-ip.js'
import { EnvService } from '../../env/env.service.js'
import { browserSessionContext } from '../frontend-context/browser-session-context.service.js'

import { Auth } from './decorators/auth.decorator.js'
import { MfaFlowStatusService } from './mfa/mfa-flow-status.service.js'
import { MfaSessionFlowService } from './mfa/mfa-session-flow.service.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from './organization-context/request-context-policy.js'

class SessionFlowInput extends createSchemaDto(mfaSessionFlowInputSchema) {}
const SessionFlowResult = createSchemaDto(mfaSessionFlowResultSchema, 'MfaSessionFlowResult')

/** Normal bearer admission and the independently verified original signed token must both agree. */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/mfa')
@Auth(AuthType.Bearer)
@OrganizationContextBoundary({ apiRoots: [] })
export class MfaSessionFlowController {
  constructor(
    private readonly flows: MfaSessionFlowService,
    private readonly statuses: MfaFlowStatusService,
    private readonly env: EnvService
  ) {}

  @Post('session-flow')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Start a restricted operation on only the original authenticated family',
  })
  @SchemaResponse({ type: SessionFlowResult, status: 200 })
  @ApiBadRequestResponse({ description: 'Invalid strict command or unexpected query' })
  @ApiUnauthorizedResponse({ description: 'Source session or signed token is invalid' })
  @ApiForbiddenResponse({ description: 'Mixed credentials or unbound browser transport' })
  @ApiConflictResponse({ description: 'Original family or browser context changed' })
  @ApiTooManyRequestsResponse({ description: 'Source or flow start budget exceeded' })
  @ApiServiceUnavailableResponse({ description: 'MFA or authority storage unavailable' })
  async start(
    @Body({ schema: SessionFlowInput.schema }) body: SessionFlowInput,
    @Req() req: Request
  ): Promise<z.infer<typeof mfaSessionFlowResultSchema>> {
    if (Object.keys(req.query ?? {}).length)
      throw new AppException('Unexpected query', 400, 'VALIDATION_ERROR')
    if (
      Object.keys(req.headers).some(
        (name) =>
          name === 'cookie' ||
          name === 'x-api-key' ||
          name === 'x-mfa-continuation' ||
          name.startsWith('x-invitation-')
      )
    )
      throw new ForbiddenException('Mixed source-session authority')
    const transport = browserSessionContext(req)
    if (transport && !transport.binding)
      throw new ForbiddenException('Source browser binding required')
    const token = /^Bearer ([^\s]+)$/i.exec(String(req.headers.authorization ?? ''))?.[1]
    if (!token) throw new AppException('Invalid source token', 401, 'TOKEN_INVALID')
    const result = await this.flows.start(
      token,
      transport?.binding ?? null,
      body.purpose,
      body.operationId,
      resolveVerifiedVisitorIp(req, this.env) ?? req.ip ?? req.socket?.remoteAddress ?? '',
      body.proofWindowSeconds
    )
    if (result.kind === 'recorded') return { kind: 'restart_required' }
    if (result.kind !== 'flow') return result
    const status = await this.statuses.read(result.request)
    return {
      ...status,
      continuation: result.request.credential,
      purpose: body.purpose,
      expiresAt: result.expiresAt.toISOString(),
      requiredProofs: status.requiredProofs,
      nextAction: status.requiredProofs.length ? 'verify' : 'complete',
      browser: result.request.browser
        ? {
            contextId: result.request.browser.contextId,
            generation: result.request.browser.generation,
          }
        : null,
    }
  }
}
