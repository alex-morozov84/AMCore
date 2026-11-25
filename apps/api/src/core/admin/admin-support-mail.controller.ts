import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'

import {
  adminDetailIdSchema,
  AuthType,
  type RequestPrincipal,
  supportMailAttemptIdSchema,
  type SupportMailPreparation,
  type SupportMailReceipt,
  type SupportMailStatus,
  SystemRole,
} from '@amcore/shared'

import { PRIVATE_NO_STORE_HEADERS, SchemaResponse } from '../../common/schemas/schema-response.js'
import { RATE_LIMIT_POLICIES, RateLimit } from '../../infrastructure/throttling/index.js'
import { Auth } from '../auth/decorators/auth.decorator.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import { SystemRoles } from '../auth/decorators/system-roles.decorator.js'

import {
  SupportMailPreparationDto,
  SupportMailPrepareDto,
  SupportMailReceiptDto,
  SupportMailStatusDto,
} from './dto/support-mail.dto.js'
import { PlatformSettingsPrincipalGuard } from './platform-settings-principal.guard.js'
import { SupportMailService } from './support-mail/support-mail.service.js'
import { SupportMailDispatch } from './support-mail/support-mail-dispatch.service.js'

@ApiTags('admin')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
@UseGuards(PlatformSettingsPrincipalGuard)
@Controller('admin/users/:id/support-mail')
@ApiParam({ name: 'id', description: 'Target user CUID or UUID' })
@ApiResponse({ status: 400, description: 'Invalid path or body' })
@ApiResponse({ status: 401, description: 'Personal bearer JWT required; API keys rejected' })
@ApiResponse({
  status: 403,
  description: 'Current SUPER_ADMIN role and live session required',
})
@ApiResponse({ status: 404, description: 'User or actor-bound attempt not found' })
export class AdminSupportMailController {
  constructor(
    private readonly service: SupportMailService,
    private readonly dispatch: SupportMailDispatch
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, headers: PRIVATE_NO_STORE_HEADERS })
  @ApiOperation({
    summary: 'Read support-mail eligibility and the operator’s latest results; never sends',
  })
  @SchemaResponse({
    type: SupportMailStatusDto,
    status: 200,
    description:
      'Eligibility, freshness and own latest attempts. An unavailable quota observation disables the action in this response.',
  })
  status(
    @CurrentUser() actor: RequestPrincipal,
    @Param('id', { schema: adminDetailIdSchema }) id: string
  ): Promise<SupportMailStatus> {
    return this.service.status(actor, id)
  }

  @Post('prepare')
  @ApiResponse({ status: 409, description: 'SUPPORT_MAIL_NOT_ELIGIBLE: the target is ineligible.' })
  @ApiResponse({
    status: 429,
    description: 'SUPPORT_MAIL_LIMIT: too many outstanding preparations.',
  })
  @ApiResponse({
    status: 503,
    description: 'Transport or preparation capacity unavailable before issuance.',
  })
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 201, headers: PRIVATE_NO_STORE_HEADERS })
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({ summary: 'Prepare a bound support-mail confirmation; no token issuance or send' })
  @SchemaResponse({
    type: SupportMailPreparationDto,
    status: 201,
    description: 'Saved recipient and single-use attempt',
  })
  prepare(
    @CurrentUser() actor: RequestPrincipal,
    @Param('id', { schema: adminDetailIdSchema }) id: string,
    @Body({ schema: SupportMailPrepareDto.schema }) body: SupportMailPrepareDto
  ): Promise<SupportMailPreparation> {
    return this.service.prepare(actor, id, body.kind)
  }

  @Post(':attemptId/send')
  @ApiResponse({
    status: 403,
    description:
      'Current SUPER_ADMIN and live session required. A new send requires recent authentication (STEP_UP_REQUIRED).',
  })
  @ApiResponse({
    status: 409,
    description:
      'SUPPORT_MAIL_BINDING_CHANGED or SUPPORT_MAIL_NOT_ELIGIBLE: reconfirm the recipient.',
  })
  @ApiResponse({ status: 410, description: 'SUPPORT_MAIL_ATTEMPT_EXPIRED: the attempt expired.' })
  @ApiResponse({
    status: 429,
    description: 'The recipient, actor, or cooldown limit refused a new send.',
  })
  @ApiResponse({
    status: 503,
    description: 'Transport or bounded capacity unavailable before claim.',
  })
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, headers: PRIVATE_NO_STORE_HEADERS })
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiParam({ name: 'attemptId', description: 'Server-issued UUID from preparation' })
  @ApiOperation({
    summary: 'Send one direct secret email; existing-attempt replay is read-only',
    description:
      'Recent authentication is required only for a new send. Issuance invalidates old same-kind links even if rendering fails. Acceptance does not prove delivery, current link validity or recipient completion. Unknown responses must be recovered via GET, never a new send.',
  })
  @SchemaResponse({
    type: SupportMailReceiptDto,
    status: 200,
    description: 'Historical attempt receipt, or evidence=unconfirmed',
  })
  send(
    @CurrentUser() actor: RequestPrincipal,
    @Param('id', { schema: adminDetailIdSchema }) id: string,
    @Param('attemptId', { schema: supportMailAttemptIdSchema }) attemptId: string
  ): Promise<SupportMailReceipt> {
    return this.dispatch.run(actor, id, attemptId)
  }

  @Get(':attemptId')
  @ApiResponse({
    status: 410,
    description: 'SUPPORT_MAIL_ATTEMPT_EXPIRED: the receipt is past its read window.',
  })
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, headers: PRIVATE_NO_STORE_HEADERS })
  @ApiParam({ name: 'attemptId', description: 'Server-issued UUID from preparation' })
  @ApiOperation({
    summary: 'Read the current operator’s saved support-mail result; no send or quota',
  })
  @SchemaResponse({
    type: SupportMailReceiptDto,
    status: 200,
    description:
      'Bound receipt, readable for 24 hours after claim. A prepared attempt has unconfirmed evidence and no issued token.',
  })
  receipt(
    @CurrentUser() actor: RequestPrincipal,
    @Param('id', { schema: adminDetailIdSchema }) id: string,
    @Param('attemptId', { schema: supportMailAttemptIdSchema }) attemptId: string
  ): Promise<SupportMailReceipt> {
    return this.dispatch.receipt(actor, id, attemptId)
  }
}
