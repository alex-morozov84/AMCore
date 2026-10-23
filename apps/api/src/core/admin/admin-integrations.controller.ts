import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'

import {
  AuthType,
  integrationIdSchema,
  type IntegrationsResponse,
  probeAttemptIdSchema,
  type ProbePreparation,
  type ProbeReceipt,
  type RequestPrincipal,
  ResourceErrorCode,
  SystemRole,
} from '@amcore/shared'

import { AppException } from '../../common/exceptions/index.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { RATE_LIMIT_POLICIES, RateLimit } from '../../infrastructure/throttling/index.js'
import { Auth } from '../auth/decorators/auth.decorator.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import { RequireFreshAuth } from '../auth/decorators/require-fresh-auth.decorator.js'
import { SystemRoles } from '../auth/decorators/system-roles.decorator.js'

import {
  IntegrationsResponseDto,
  ProbePreparationDto,
  ProbeReceiptDto,
  ProbeRequestDto,
} from './dto/integrations.dto.js'
import { IntegrationRegistry } from './integrations/integration-registry.js'
import { PlatformSettingsPrincipalGuard } from './platform-settings-principal.guard.js'

/**
 * Bearer-only like every admin route: an API key owned by a SUPER_ADMIN must not satisfy the
 * system-role check, and an organization-exchanged credential cannot reach platform probes.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/integrations')
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
@UseGuards(PlatformSettingsPrincipalGuard)
@ApiResponse({ status: 401, description: 'Personal bearer JWT required; API keys rejected' })
@ApiResponse({ status: 403, description: 'Current SUPER_ADMIN required' })
@ApiResponse({ status: 429, description: 'Rate limit exceeded' })
export class AdminIntegrationsController {
  constructor(private readonly registry: IntegrationRegistry) {}

  private probe(id: string): NonNullable<ReturnType<IntegrationRegistry['probe']>> {
    const probe = this.registry.probe(id)
    if (!probe)
      throw new AppException(
        ResourceErrorCode.RESOURCE_NOT_FOUND,
        404,
        ResourceErrorCode.RESOURCE_NOT_FOUND
      )
    return probe
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Read the safe state of registered integrations — live SUPER_ADMIN bearer only',
    description:
      'One item per registered integration (at most 32). Configuration, last observation, its ' +
      'freshness and the reader state are separate fields. Reading never runs a provider check, ' +
      'sends mail or writes a file. Only closed codes, counters and short safe facts are returned: ' +
      'no secrets, URLs, addresses or provider text.',
  })
  @SchemaResponse({
    type: IntegrationsResponseDto,
    status: 200,
    description: 'Integration state read at the answering API instance',
  })
  list(@CurrentUser() actor: RequestPrincipal): Promise<IntegrationsResponse> {
    return this.registry.list(actor.sub)
  }

  @Post(':id/probe/prepare')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({
    summary: 'Issue a single-use attempt id and the masked recipient for an operator test',
    description:
      'Nothing is sent. The returned id is bound to the acting operator, the current recipient ' +
      'and the current provider settings, and expires after 30 minutes.',
  })
  @ApiParam({ name: 'id', description: 'Integration id from the list' })
  @ApiResponse({ status: 404, description: 'Unknown integration or no probe registered' })
  @ApiResponse({ status: 409, description: 'No verified address, or mock email in production' })
  @ApiResponse({ status: 503, description: 'The check could not start; nothing was sent' })
  @SchemaResponse({ type: ProbePreparationDto, status: 200, description: 'Prepared attempt' })
  prepare(
    @Param('id', { schema: integrationIdSchema }) id: string,
    @CurrentUser() actor: RequestPrincipal
  ): Promise<ProbePreparation> {
    return this.probe(id).port.prepare(actor.sub)
  }

  @Post(':id/probe')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({
    summary: 'Run the operator test with a prepared attempt id',
    description:
      "Sends one fixed test message to the acting operator's own verified address. A repeated " +
      'request with the same id returns the stored attempt and never sends again. An accepted ' +
      'result means the provider accepted a direct send from this server, not that it reached ' +
      'an inbox. A timeout or a reported limit is `unknown`.',
  })
  @ApiParam({ name: 'id', description: 'Integration id from the list' })
  @ApiResponse({ status: 404, description: 'Unknown integration or no probe registered' })
  @ApiResponse({
    status: 409,
    description:
      'INTEGRATION_ATTEMPT_MISMATCH, INTEGRATION_RECIPIENT_CHANGED, INTEGRATION_CONFIG_CHANGED, ' +
      'INTEGRATION_NO_VERIFIED_ADDRESS or INTEGRATION_MOCK_IN_PRODUCTION',
  })
  @ApiResponse({ status: 410, description: 'INTEGRATION_ATTEMPT_EXPIRED; prepare again' })
  @ApiResponse({ status: 429, description: 'Cooldown, hourly limit or another test in flight' })
  @ApiResponse({
    status: 503,
    description:
      'INTEGRATION_PROBE_UNAVAILABLE: refused BEFORE anything was sent. After a send the answer is 200 ' +
      'with the stored receipt, or with outcome `in_progress` when it cannot be read yet; read the ' +
      'receipt route, do not send again',
  })
  @SchemaResponse({ type: ProbeReceiptDto, status: 200, description: 'Receipt of the attempt' })
  run(
    @Param('id', { schema: integrationIdSchema }) id: string,
    @Body({ schema: ProbeRequestDto.schema }) body: ProbeRequestDto,
    @CurrentUser() actor: RequestPrincipal
  ): Promise<ProbeReceipt> {
    const { port, policy } = this.probe(id)
    return port.run(actor.sub, body.attemptId, policy)
  }

  @Get(':id/probe/:attemptId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: "Read the stored receipt of the acting operator's own attempt",
    description:
      'Read-only recovery after a timeout or a reload. It never creates an attempt and never ' +
      "sends. Another operator's attempt answers 404.",
  })
  @ApiParam({ name: 'id', description: 'Integration id from the list' })
  @ApiParam({ name: 'attemptId', description: 'Attempt id from prepare' })
  @ApiResponse({ status: 404, description: 'Unknown, expired or foreign attempt' })
  @SchemaResponse({ type: ProbeReceiptDto, status: 200, description: 'Receipt of the attempt' })
  receipt(
    @Param('id', { schema: integrationIdSchema }) id: string,
    @Param('attemptId', { schema: probeAttemptIdSchema }) attemptId: string,
    @CurrentUser() actor: RequestPrincipal
  ): Promise<ProbeReceipt> {
    return this.probe(id).port.receiptFor(actor.sub, attemptId)
  }
}
