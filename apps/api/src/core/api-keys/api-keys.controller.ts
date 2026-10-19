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
  Req,
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
import type { FastifyRequest } from 'fastify'

import {
  type ApiKeyListResponse,
  AuthType,
  type OwnKeyOrganizations,
  PAGINATION,
  type RequestPrincipal,
} from '@amcore/shared'

import { BadRequestException } from '../../common/exceptions/index.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { Auth } from '../auth/decorators/auth.decorator.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'

import { ApiKeysService, type CreateApiKeyResult } from './api-keys.service.js'
import { ApiKeyListResponseDto } from './dto/api-key-list-response.dto.js'
import { ApiKeyQueryDto } from './dto/api-key-query.dto.js'
import { CreateApiKeyDto } from './dto/create-api-key.dto.js'
import { CreateApiKeyResponseDto } from './dto/create-api-key-response.dto.js'
import {
  OwnKeyOrganizationsDto,
  OwnKeyOrganizationsQueryDto,
} from './dto/own-key-organizations.dto.js'
import { OwnKeyOrganizationsService } from './own-key-organizations.service.js'

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
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly organizations: OwnKeyOrganizationsService
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an API key for the current user — returns the secret once' })
  @SchemaResponse({ type: CreateApiKeyResponseDto, status: 201, description: 'API key created' })
  create(
    @CurrentUser() user: RequestPrincipal,
    @Body({ schema: CreateApiKeyDto.schema }) dto: CreateApiKeyDto
  ): Promise<CreateApiKeyResult> {
    return this.apiKeysService.create(user.sub, dto)
  }

  @Get('organizations')
  @ApiOperation({
    summary: 'List bounded organization options for own API-key inventory or creation',
  })
  @ApiQuery({ name: 'purpose', enum: ['inventory', 'creation'], required: true })
  @ApiQuery({ name: 'search', type: String, required: false, maxLength: 100 })
  @ApiQuery({ name: 'selectedId', type: String, required: false })
  @ApiQuery({ name: 'page', type: Number, required: false, minimum: 1 })
  @ApiQuery({ name: 'limit', type: Number, required: false, minimum: 1, maximum: 20 })
  @SchemaResponse({
    type: OwnKeyOrganizationsDto,
    status: 200,
    description: 'Actor-scoped organization options; creation hints are not issuance authority',
  })
  listOrganizations(
    @CurrentUser() user: RequestPrincipal,
    @Query({ schema: OwnKeyOrganizationsQueryDto.schema }) query: OwnKeyOrganizationsQueryDto,
    @Req() request: FastifyRequest
  ): Promise<OwnKeyOrganizations> {
    assertOwnQueryBudget(request)
    return this.organizations.list(user, query)
  }

  @Get()
  @ApiQuery({ name: 'search', type: String, required: false, maxLength: 100 })
  @ApiQuery({ name: 'organizationId', type: String, required: false })
  @ApiQuery({ name: 'organizationAvailability', enum: ['unavailable'], required: false })
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
  @SchemaResponse({ type: ApiKeyListResponseDto, status: 200, description: 'Paginated API keys' })
  findAll(
    @CurrentUser() user: RequestPrincipal,
    @Query({ schema: ApiKeyQueryDto.schema }) pagination: ApiKeyQueryDto,
    @Req() request: FastifyRequest
  ): Promise<ApiKeyListResponse> {
    assertOwnQueryBudget(request)
    return this.apiKeysService.findAllForUser(
      user.sub,
      pagination.page,
      pagination.limit,
      pagination.status,
      pagination
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

function assertOwnQueryBudget(request: FastifyRequest): void {
  if (Buffer.byteLength(request.url.split('?')[1] ?? '', 'utf8') > 2048)
    throw new BadRequestException('Query too large')
}
