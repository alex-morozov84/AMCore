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
import { ApiNoContentResponse, ApiQuery } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import {
  type ApiKeyListResponse,
  AuthType,
  PAGINATION,
  type RequestPrincipal,
} from '@amcore/shared'

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import { ApiKeysService, type CreateApiKeyResult } from './api-keys.service'
import { ApiKeyListResponseDto } from './dto/api-key-list-response.dto'
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
 * list, or revoke API keys. See `ai/API_KEYS_REVIEW.md` AK-01 and
 * ADR-024 / ADR-034.
 */
@Auth(AuthType.Bearer)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @ZodResponse({ type: CreateApiKeyResponseDto, status: 201, description: 'API key created' })
  create(
    @CurrentUser() user: RequestPrincipal,
    @Body() dto: CreateApiKeyDto
  ): Promise<CreateApiKeyResult> {
    return this.apiKeysService.create(user.sub, dto)
  }

  @Get()
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
  @ZodResponse({ type: ApiKeyListResponseDto, status: 200, description: 'Paginated API keys' })
  findAll(
    @CurrentUser() user: RequestPrincipal,
    @Query() pagination: PaginationQueryDto
  ): Promise<ApiKeyListResponse> {
    return this.apiKeysService.findAllForUser(user.sub, pagination.page, pagination.limit)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'API key revoked' })
  revoke(@CurrentUser() user: RequestPrincipal, @Param('id') id: string): Promise<void> {
    return this.apiKeysService.revoke(id, user.sub)
  }
}
