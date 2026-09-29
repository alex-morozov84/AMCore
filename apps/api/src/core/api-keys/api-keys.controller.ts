import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import {
  type ApiKeyListResponse,
  AuthType,
  PAGINATION,
  type RequestPrincipal,
} from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import { ApiKeysService, type CreateApiKeyResult } from './api-keys.service'
import { ApiKeyListResponseDto } from './dto/api-key-list-response.dto'
import { ApiKeyQueryDto } from './dto/api-key-query.dto'
import { CreateApiKeyDto } from './dto/create-api-key.dto'
import { CreateApiKeyResponseDto } from './dto/create-api-key-response.dto'

/**
 * Credential management routes are bearer-only.
 *
 * After ADR-034 (Stage 1c) the runtime default in
 * `AuthenticationGuard` is `[AuthType.Bearer]`, so an undecorated
 * controller would already reject API keys. We still pin the
 * annotation here explicitly — every route under `core/**` declares
 * its accepted auth types per the ADR-034 allowlist, and the
 * metadata guardrail test enforces that. Credential issuance and
 * revocation are high-risk operations that must require an
 * interactive user session — an API key must not be able to create,
 * list, or revoke API keys. The explicit auth annotation also
 * supports automated metadata coverage.
 */
@ApiTags('api-keys')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@ApiResponse({
  status: 401,
  description: 'Bearer JWT required; API keys cannot manage credentials',
})
@ApiResponse({ status: 400, description: 'Invalid input' })
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @ApiOperation({ summary: 'Create an API key for the current user — returns the secret once' })
  @ZodResponse({ type: CreateApiKeyResponseDto, status: 201, description: 'API key created' })
  create(
    @CurrentUser() user: RequestPrincipal,
    @Body() dto: CreateApiKeyDto
  ): Promise<CreateApiKeyResult> {
    return this.apiKeysService.create(user.sub, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List API keys owned by the current user' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    minimum: 1,
    example: PAGINATION.DEFAULT_PAGE,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: PAGINATION.MAX_LIMIT,
    example: PAGINATION.DEFAULT_LIMIT,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['all', 'unexpired', 'expired', 'revoked'],
    description:
      'Default all includes retained historical rows; lifecycle status does not guarantee access',
  })
  @ZodResponse({ type: ApiKeyListResponseDto, status: 200, description: 'Paginated API keys' })
  findAll(
    @CurrentUser() user: RequestPrincipal,
    @Query() pagination: ApiKeyQueryDto
  ): Promise<ApiKeyListResponse> {
    return this.apiKeysService.findAllForUser(
      user.sub,
      pagination.page,
      pagination.limit,
      pagination.status
    )
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API key owned by the current user' })
  @ApiParam({ name: 'id', type: String, description: 'Owned API-key ID' })
  @ApiResponse({ status: 404, description: 'Unknown, foreign or purged key' })
  @ApiNoContentResponse({
    description: 'Irreversibly revoked, verifier destroyed; known revoked key is a no-op',
  })
  revoke(@CurrentUser() user: RequestPrincipal, @Param('id') id: string): Promise<void> {
    return this.apiKeysService.revoke(id, user.sub)
  }
}
