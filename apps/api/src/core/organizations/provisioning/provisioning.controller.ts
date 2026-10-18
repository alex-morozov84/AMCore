import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'

import { AuthType, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { SchemaResponse } from '../../../common/schemas/schema-response.js'
import { EnvService } from '../../../env/env.service.js'
import { RATE_LIMIT_POLICIES, RateLimit } from '../../../infrastructure/throttling/index.js'
import { Auth } from '../../auth/decorators/auth.decorator.js'
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js'
import { RequireFreshAuth } from '../../auth/decorators/require-fresh-auth.decorator.js'
import { SystemRoles } from '../../auth/decorators/system-roles.decorator.js'
import { parseInvitationOperationId } from '../invitation-operation.js'
import type { SetupOperator } from '../organization-setup-admission.js'

import {
  ProvisioningCancelDto,
  ProvisioningCommandReceiptDto,
  ProvisioningCreateDto,
  ProvisioningLookupDto,
  ProvisioningPolicyDto,
  ProvisioningProgressDto,
  ProvisioningReceiptDto,
  ProvisioningReissueDto,
  ProvisioningReplaceDto,
} from './provisioning.dto.js'
import { ProvisioningService } from './provisioning.service.js'

@ApiTags('admin')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
@Controller('admin')
@ApiResponse({ status: 400, description: 'Invalid input or unknown field' })
@ApiResponse({ status: 401, description: 'Live personal bearer session required' })
@ApiResponse({
  status: 403,
  description: 'Current SUPER_ADMIN required; mutations require fresh authentication',
})
@ApiResponse({ status: 404, description: 'PROVISIONING_NOT_FOUND' })
@ApiResponse({
  status: 409,
  description:
    'Intent, creator, revision, invitation or closed-process conflict; no implicit retry',
})
@ApiResponse({ status: 410, description: 'PROVISIONING_ORGANIZATION_UNAVAILABLE' })
@ApiResponse({ status: 429, description: 'Rate limit; Retry-After supplied' })
@ApiResponse({
  status: 500,
  description: 'SYSTEM_NOT_INITIALIZED; canonical ADMIN must be initialized by deployment',
})
@ApiResponse({
  status: 503,
  description:
    'Busy, admission unavailable, unconfirmed commit or production email not configured; inspect original operation',
})
export class ProvisioningController {
  constructor(
    private readonly service: ProvisioningService,
    private readonly env: EnvService
  ) {}
  private operator(principal: RequestPrincipal): SetupOperator {
    return { principal, freshWindowSeconds: this.env.get('STEP_UP_MAX_AGE_SECONDS') }
  }
  @Get('organization-provisionings/policy')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Inspect first-admin invitation readiness; never creates an organization',
  })
  @SchemaResponse({ type: ProvisioningPolicyDto, status: 200 })
  policy(@CurrentUser() principal: RequestPrincipal): Promise<ProvisioningPolicyDto> {
    return this.service.readiness(this.operator(principal))
  }
  @Post('organization-provisionings')
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({
    summary: 'Create an organization and first ADMIN invitation atomically',
    description:
      'Mandatory UUIDv7 operation identity; exact replay never resends mail. Recipient must verify email and explicitly accept; operator receives no membership.',
  })
  @SchemaResponse({ type: ProvisioningReceiptDto, status: 201 })
  create(
    @Body({ schema: ProvisioningCreateDto.schema }) input: ProvisioningCreateDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<ProvisioningReceiptDto> {
    return this.service.create(input, this.operator(principal))
  }
  @Get('organization-provisionings/operations/:operationId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Recover immutable creation result; unrecorded alone does not prove rollback',
  })
  @ApiParam({
    name: 'operationId',
    description: 'Original UUIDv7; readable by any current SUPER_ADMIN',
  })
  @SchemaResponse({ type: ProvisioningLookupDto, status: 200 })
  lookup(
    @Param('operationId') id: string,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<ProvisioningService['lookup']> {
    return this.service.lookup(parseInvitationOperationId(id), this.operator(principal))
  }
  @Get('organizations/:orgId/provisioning')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Inspect initial ADMIN progress and original-grant access separately' })
  @ApiParam({ name: 'orgId', description: 'Original organization ID' })
  @SchemaResponse({ type: ProvisioningProgressDto, status: 200 })
  progress(
    @Param('orgId') id: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<ProvisioningProgressDto> {
    return this.service.progress(id, this.operator(principal))
  }
  @Post('organizations/:orgId/provisioning/reissue')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({
    summary: 'Explicitly reissue the current initial ADMIN invitation; old links stop working',
  })
  @ApiParam({ name: 'orgId', description: 'Unfinished provisioned organization ID' })
  @SchemaResponse({ type: ProvisioningCommandReceiptDto, status: 200 })
  reissue(
    @Param('orgId') id: string,
    @Body({ schema: ProvisioningReissueDto.schema }) input: ProvisioningReissueDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<ProvisioningCommandReceiptDto> {
    return this.service.recover(id, { kind: 'reissue', input }, this.operator(principal))
  }
  @Post('organizations/:orgId/provisioning/replace-recipient')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({
    summary:
      'Explicitly choose a recipient for the same unfinished organization, including after invitation retention',
  })
  @ApiParam({ name: 'orgId', description: 'Unfinished provisioned organization ID' })
  @SchemaResponse({ type: ProvisioningCommandReceiptDto, status: 200 })
  replace(
    @Param('orgId') id: string,
    @Body({ schema: ProvisioningReplaceDto.schema }) input: ProvisioningReplaceDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<ProvisioningCommandReceiptDto> {
    return this.service.recover(id, { kind: 'replace', input }, this.operator(principal))
  }
  @Post('organizations/:orgId/provisioning/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({
    summary:
      'End initial provisioning without an ADMIN; organization remains and this process cannot resume',
  })
  @ApiParam({ name: 'orgId', description: 'Unfinished provisioned organization ID' })
  @SchemaResponse({ type: ProvisioningCommandReceiptDto, status: 200 })
  cancel(
    @Param('orgId') id: string,
    @Body({ schema: ProvisioningCancelDto.schema }) input: ProvisioningCancelDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<ProvisioningCommandReceiptDto> {
    return this.service.recover(id, { kind: 'cancel', input }, this.operator(principal))
  }
}
