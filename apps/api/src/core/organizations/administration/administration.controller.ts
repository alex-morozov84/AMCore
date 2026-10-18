import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common'
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

import * as Dto from './administration.dto.js'
import { AdministrationService } from './administration.service.js'

@ApiTags('admin')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
@Controller('admin/organizations')
@ApiResponse({ status: 400, description: 'Invalid bounded input or unknown field' })
@ApiResponse({
  status: 401,
  description: 'Live owned personal session required; API keys are not accepted',
})
@ApiResponse({
  status: 403,
  description: 'Current personal SUPER_ADMIN required; writes require fresh authentication',
})
@ApiResponse({ status: 404, description: 'Organization, intent or selected member unavailable' })
@ApiResponse({
  status: 409,
  description:
    'Stale identity/revision/ACL, managed invite, terminal intent or operation conflict; inspect before retry',
})
@ApiResponse({
  status: 429,
  description: 'Shared invitation quota or privileged HTTP rate limit; Retry-After supplied',
})
@ApiResponse({
  status: 500,
  description: 'Canonical ADMIN template not initialized; no automatic permission repair',
})
@ApiResponse({
  status: 503,
  description:
    'Mail not configured, admission unavailable, busy or commit unconfirmed; preserve operation identity',
})
export class AdministrationController {
  constructor(
    private readonly service: AdministrationService,
    private readonly env: EnvService
  ) {}
  private operator(principal: RequestPrincipal): SetupOperator {
    return { principal, freshWindowSeconds: this.env.get('STEP_UP_MAX_AGE_SECONDS') }
  }
  @Get('attention')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List all organizations without an ADMIN or with unfinished managed ADMIN invitations',
    description:
      'Counts awaiting intents even when expired or recipient data was pruned; never infers current access from historical completion.',
  })
  @SchemaResponse({ type: Dto.AdministratorAttentionDto, status: 200 })
  attention(
    @Query({ schema: Dto.AdministratorAttentionQueryDto.schema })
    query: Dto.AdministratorAttentionQueryDto,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<AdministrationService['attention']> {
    return this.service.attention(query, this.operator(principal))
  }
  @Get(':orgId/administration')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Inspect current canonical ADMINs and unfinished administrator invitations',
    description:
      'Both lists are paginated independently within one SQL snapshot; historical initial provisioning is separate.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @SchemaResponse({ type: Dto.AdministratorSummaryDto, status: 200 })
  summary(
    @Param('orgId') id: string,
    @Query({ schema: Dto.AdministratorSummaryQueryDto.schema })
    query: Dto.AdministratorSummaryQueryDto,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<AdministrationService['summary']> {
    return this.service.summary(id, query, this.operator(principal))
  }
  @Get(':orgId/administrator-invitations/:invitationId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Inspect a managed additional ADMIN invitation without sending email' })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({
    name: 'invitationId',
    description: 'Additional ADMIN intent UUIDv7, not the secret link or ordinary invite ID',
  })
  @SchemaResponse({ type: Dto.AdministratorInvitationProgressDto, status: 200 })
  progress(
    @Param('orgId') orgId: string,
    @Param('invitationId') id: string,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<AdministrationService['progress']> {
    return this.service.progress(orgId, parseInvitationOperationId(id), this.operator(principal))
  }
  @Get(':orgId/administrator-operations/:operationId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Recover this operator’s committed administrator command',
    description:
      'Unknown does not prove rollback. Preserve the original operation and frozen input; another operator uses current organization state and a new explicit command.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'operationId', description: 'Original actor-bound UUIDv7' })
  @SchemaResponse({ type: Dto.AdministratorOperationDto, status: 200 })
  lookup(
    @Param('orgId') orgId: string,
    @Param('operationId') id: string,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<AdministrationService['lookup']> {
    return this.service.lookup(orgId, parseInvitationOperationId(id), this.operator(principal))
  }
  @Post(':orgId/administrator-invitations')
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({
    summary: 'Invite an additional ADMIN; never join the operator or reopen initial provisioning',
    description:
      'Bounded security-audit reason required. Exact operation replay never resends email. Recipient must verify email and explicitly accept.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @SchemaResponse({ type: Dto.AdministratorCommandReceiptDto, status: 201 })
  create(
    @Param('orgId') orgId: string,
    @Body({ schema: Dto.AdministratorInvitationCreateDto.schema })
    input: Dto.AdministratorInvitationCreateDto,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<AdministrationService['command']> {
    return this.service.command(orgId, { kind: 'create', input }, this.operator(principal))
  }
  @Post(':orgId/administrator-invitations/:invitationId/reissue')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({
    summary: 'Explicitly issue a new link for this recipient; old links stop working',
    description:
      'Bounded security-audit reason required. Exact operation replay never resends email. Recipient must verify email and explicitly accept.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'invitationId', description: 'Additional ADMIN intent UUIDv7' })
  @SchemaResponse({ type: Dto.AdministratorCommandReceiptDto, status: 200 })
  reissue(
    @Param('orgId') orgId: string,
    @Param('invitationId') id: string,
    @Body({ schema: Dto.AdministratorInvitationReissueDto.schema })
    input: Dto.AdministratorInvitationReissueDto,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<AdministrationService['command']> {
    return this.service.command(
      orgId,
      { kind: 'reissue', id: parseInvitationOperationId(id), input },
      this.operator(principal)
    )
  }
  @Post(':orgId/administrator-invitations/:invitationId/replace-recipient')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({
    summary: 'Explicitly select another recipient for an unfinished ADMIN intent',
    description:
      'Bounded security-audit reason required. Exact operation replay never resends email. Recipient must verify email and explicitly accept.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'invitationId', description: 'Additional ADMIN intent UUIDv7' })
  @SchemaResponse({ type: Dto.AdministratorCommandReceiptDto, status: 200 })
  replace(
    @Param('orgId') orgId: string,
    @Param('invitationId') id: string,
    @Body({ schema: Dto.AdministratorInvitationReplaceDto.schema })
    input: Dto.AdministratorInvitationReplaceDto,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<AdministrationService['command']> {
    return this.service.command(
      orgId,
      { kind: 'replace', id: parseInvitationOperationId(id), input },
      this.operator(principal)
    )
  }
  @Post(':orgId/administrator-invitations/:invitationId/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({
    summary: 'Cancel this ADMIN invitation; preserve the organization and other administrators',
    description:
      'Bounded security-audit reason required. Revokes this link without removing the organization or current administrators. Exact replay makes no new changes.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiParam({ name: 'invitationId', description: 'Additional ADMIN intent UUIDv7' })
  @SchemaResponse({ type: Dto.AdministratorCommandReceiptDto, status: 200 })
  cancel(
    @Param('orgId') orgId: string,
    @Param('invitationId') id: string,
    @Body({ schema: Dto.AdministratorInvitationCancelDto.schema })
    input: Dto.AdministratorInvitationCancelDto,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<AdministrationService['command']> {
    return this.service.command(
      orgId,
      { kind: 'cancel', id: parseInvitationOperationId(id), input },
      this.operator(principal)
    )
  }
  @Post(':orgId/administrators')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({
    summary: 'Explicitly add canonical ADMIN to an existing verified member',
    description:
      'Exact user/member/ACL identity and security-audit reason required. Preserves all other roles and administrators; retained replay never restores removed access.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @SchemaResponse({ type: Dto.AdministratorAssignmentReceiptDto, status: 200 })
  assign(
    @Param('orgId') orgId: string,
    @Body({ schema: Dto.AdministratorAssignmentDto.schema }) input: Dto.AdministratorAssignmentDto,
    @CurrentUser() principal: RequestPrincipal
  ): ReturnType<AdministrationService['assign']> {
    return this.service.assign(orgId, input, this.operator(principal))
  }
}
