import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { ZodResponse, ZodValidationException } from 'nestjs-zod'
import { z } from 'zod'

import { AuthType, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { RATE_LIMIT_POLICIES, RateLimit } from '../../infrastructure/throttling'
import { ApiKeyRevocationService } from '../api-keys/api-key-revocation.service'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireFreshAuth } from '../auth/decorators/require-fresh-auth.decorator'
import { SystemRoles } from '../auth/decorators/system-roles.decorator'

import { AdminApiKeysService } from './admin-api-keys.service'
import {
  AdminApiKeyListDto,
  AdminApiKeyQueryDto,
  AdminApiKeyRevokeDto,
  AdminApiKeyRevokeResultDto,
} from './dto/admin-api-key.dto'

@ApiTags('admin')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
@ApiResponse({ status: 401, description: 'Bearer JWT required; API keys rejected' })
@ApiResponse({
  status: 403,
  description: 'Current SUPER_ADMIN required; mutations require fresh authentication',
})
@ApiResponse({ status: 400, description: 'Invalid query or target IDs' })
@ApiResponse({
  status: 429,
  description: 'Rate limit exceeded; observe Retry-After, no automatic mutation retry',
})
@Controller('admin/api-keys')
export class AdminApiKeysController {
  constructor(
    private readonly inventory: AdminApiKeysService,
    private readonly revocation: ApiKeyRevocationService
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RateLimit(RATE_LIMIT_POLICIES.AUDIT_READ)
  @ApiOperation({ summary: 'Browse platform API-key metadata with strict read accountability' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  })
  @ApiQuery({
    name: 'search',
    required: false,
    schema: { type: 'string', maxLength: 100 },
    description: 'Literal case-insensitive name substring; trimmed',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    type: String,
    description: 'Exact owner CUID or UUID',
  })
  @ApiQuery({
    name: 'organizationId',
    required: false,
    type: String,
    description: 'Exact organization CUID or UUID',
  })
  @ApiQuery({ name: 'id', required: false, type: String, description: 'Exact key CUID' })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'unexpired', 'expired', 'revoked'] })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['name', 'createdAt', 'expiresAt', 'lastUsedAt', 'revokedAt'],
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['asc', 'desc'],
    description: 'Name defaults ascending; other fields descending; nullable dates last',
  })
  @ApiResponse({
    status: 503,
    description: 'Inventory or mandatory read-audit unavailable; no metadata returned',
  })
  @ZodResponse({
    type: AdminApiKeyListDto,
    status: 200,
    description: 'Paginated safe credential metadata; status is lifecycle only',
  })
  list(
    @Query() query: AdminApiKeyQueryDto,
    @CurrentUser() actor: RequestPrincipal
  ): Promise<AdminApiKeyListResponse> {
    return this.inventory.list(query, actor.sub)
  }

  @Delete(':id')
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @ApiOperation({ summary: 'Irreversibly revoke one API key; known revoked keys are a no-op' })
  @ApiParam({ name: 'id', description: 'API-key CUID', type: String })
  @ApiResponse({ status: 404, description: 'Unknown or purged key' })
  @ZodResponse({
    type: AdminApiKeyRevokeResultDto,
    status: 200,
    description: 'Actual requested and affected counts',
  })
  revoke(
    @Param('id') id: string,
    @CurrentUser() actor: RequestPrincipal
  ): Promise<AdminApiKeyRevokeResponse> {
    const parsed = z.cuid().safeParse(id)
    if (!parsed.success) throw new ZodValidationException(parsed.error)
    return this.revocation.revoke([parsed.data], actor.sub, true)
  }

  @Post('revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.EXPENSIVE_ACTION)
  @ApiOperation({
    summary:
      'Revoke 1–100 selected distinct key IDs atomically; unknown targets roll back the batch',
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown or purged target; refresh and reselect, no key changed',
  })
  @ZodResponse({
    type: AdminApiKeyRevokeResultDto,
    status: 200,
    description: 'Actual requested and affected counts',
  })
  revokeSelected(
    @Body() body: AdminApiKeyRevokeDto,
    @CurrentUser() actor: RequestPrincipal
  ): Promise<AdminApiKeyRevokeResponse> {
    return this.revocation.revoke(body.ids, actor.sub, true)
  }
}
