import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'

import type { RequestPrincipal } from '@amcore/shared'

import { CurrentUser } from '../auth/decorators/current-user.decorator'

import { type ApiKeyListItem, ApiKeysService, type CreateApiKeyResult } from './api-keys.service'
import { CreateApiKeyDto } from './dto/create-api-key.dto'

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
