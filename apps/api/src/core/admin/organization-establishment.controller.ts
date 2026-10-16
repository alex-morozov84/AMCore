import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'

import { AuthType, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { SchemaResponse } from '../../common/schemas/schema-response'
import { EnvService } from '../../env/env.service'
import { PrismaService } from '../../prisma'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireFreshAuth } from '../auth/decorators/require-fresh-auth.decorator'
import { SystemRoles } from '../auth/decorators/system-roles.decorator'
import {
  OrganizationBootstrapDto,
  OrganizationBootstrapResultDto,
  OrganizationPrepareAccountDto,
  OrganizationPreparedAccountDto,
  OrganizationSetupAccountDto,
  OrganizationSetupStatusDto,
} from '../organizations/dto/organization-establishment.dto'
import type { SetupOperator } from '../organizations/organization-setup-admission'
import { OrganizationSetupOperations } from '../organizations/organization-setup-operations'

@ApiTags('admin')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
@Controller('admin/organization-establishment')
@ApiResponse({ status: 401, description: 'Live personal bearer session required' })
@ApiResponse({
  status: 403,
  description: 'Current SUPER_ADMIN required; mutations require fresh authentication',
})
@ApiResponse({
  status: 409,
  description: 'SETUP_CLOSED, SETUP_NOT_READY, SETUP_INTENT_MISMATCH or SETUP_STATE_CHANGED',
})
@ApiResponse({
  status: 503,
  description: 'SETUP_BUSY (Retry-After: 1) or SETUP_UNCONFIRMED; preserve original intent',
})
export class OrganizationEstablishmentController {
  constructor(
    private readonly db: PrismaService,
    private readonly env: EnvService
  ) {}

  private operations(): OrganizationSetupOperations {
    return new OrganizationSetupOperations(
      this.db,
      this.env.get('ORG_SELF_SERVICE_CREATION_ENABLED')
    )
  }
  private operator(principal: RequestPrincipal): SetupOperator {
    return { principal, freshWindowSeconds: this.env.get('STEP_UP_MAX_AGE_SECONDS') }
  }

  @Header('Cache-Control', 'private, no-store')
  @Get('status')
  @ApiOperation({ summary: 'Inspect initial organization setup state; never starts setup' })
  @SchemaResponse({ type: OrganizationSetupStatusDto, status: 200 })
  status(@CurrentUser() principal: RequestPrincipal): Promise<OrganizationSetupStatusDto> {
    return this.operations().status(this.operator(principal))
  }

  @Header('Cache-Control', 'private, no-store')
  @Post('accounts/prepare')
  @HttpCode(200)
  @RequireFreshAuth()
  @ApiOperation({
    summary: 'Prepare an ordinary passwordless USER only while setup is eligible',
    description:
      'Existing credentials and roles are never changed. Recipient uses ordinary password recovery to prove mailbox control.',
  })
  @ApiResponse({ status: 400, description: 'Invalid email, locale or unknown field' })
  @SchemaResponse({ type: OrganizationPreparedAccountDto, status: 200 })
  prepare(
    @Body({ schema: OrganizationPrepareAccountDto.schema }) input: OrganizationPrepareAccountDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<OrganizationPreparedAccountDto> {
    return this.operations().prepare(input, this.operator(principal))
  }

  @Header('Cache-Control', 'private, no-store')
  @Get('accounts/:userId/status')
  @ApiOperation({
    summary:
      'Refresh the selected setup identity; after completion only the original recipient is readable',
  })
  @ApiParam({ name: 'userId', description: 'Explicit selected user ID' })
  @ApiResponse({ status: 404, description: 'SETUP_ACCOUNT_UNAVAILABLE: selected identity missing' })
  @SchemaResponse({ type: OrganizationSetupAccountDto, status: 200 })
  account(
    @Param('userId') userId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<OrganizationSetupAccountDto> {
    return this.operations().account(userId, this.operator(principal))
  }

  @Header('Cache-Control', 'private, no-store')
  @Post('bootstrap')
  @HttpCode(200)
  @RequireFreshAuth()
  @ApiOperation({
    summary: 'Establish the initial organization and verified recipient ADMIN atomically',
    description:
      'Exact repeats verify original identities read-only. Operator receives no membership unless explicitly selected.',
  })
  @ApiResponse({ status: 400, description: 'Invalid input or unknown field' })
  @ApiResponse({ status: 422, description: 'SETUP_ACCOUNT_UNAVAILABLE or SETUP_EMAIL_UNVERIFIED' })
  @SchemaResponse({ type: OrganizationBootstrapResultDto, status: 200 })
  bootstrap(
    @Body({ schema: OrganizationBootstrapDto.schema }) input: OrganizationBootstrapDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<OrganizationBootstrapResultDto> {
    return this.operations().bootstrap(input, this.operator(principal))
  }
}
