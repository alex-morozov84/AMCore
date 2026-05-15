import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'

import { AuthType, type RequestPrincipal } from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import { type ApiKeyListItem, ApiKeysService, type CreateApiKeyResult } from './api-keys.service'
import { CreateApiKeyDto } from './dto/create-api-key.dto'

/**
 * Credential management routes are bearer-only.
 *
 * The global auth default accepts both JWT and API key, but credential issuance
 * and revocation are high-risk operations that must require an interactive
 * user session — an API key must not be able to create, list, or revoke API
 * keys. See `ai/API_KEYS_REVIEW.md` AK-01 and ADR-024.
 */
@Auth(AuthType.Bearer)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: RequestPrincipal,
    @Body() dto: CreateApiKeyDto
  ): Promise<CreateApiKeyResult> {
    return this.apiKeysService.create(user.sub, dto)
  }

  @Get()
  findAll(@CurrentUser() user: RequestPrincipal): Promise<ApiKeyListItem[]> {
    return this.apiKeysService.findAllForUser(user.sub)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: RequestPrincipal, @Param('id') id: string): Promise<void> {
    return this.apiKeysService.revoke(id, user.sub)
  }
}
