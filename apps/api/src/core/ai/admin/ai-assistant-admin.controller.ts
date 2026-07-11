import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ZodResponse } from 'nestjs-zod'

import {
  type AiAssistantListResponse,
  type AiAssistantResponse,
  AuthType,
  type RequestPrincipal,
  SystemRole,
} from '@amcore/shared'

import { Auth } from '../../auth/decorators/auth.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import { RequireFreshAuth } from '../../auth/decorators/require-fresh-auth.decorator'
import { SystemRoles } from '../../auth/decorators/system-roles.decorator'

import { AiAssistantAdminService } from './ai-assistant-admin.service'
import {
  AiAssistantListQueryDto,
  AiAssistantListResponseDto,
  AiAssistantResponseDto,
  CreateAiAssistantDto,
  PublishAiAssistantVersionDto,
  UpdateAiAssistantDto,
} from './dto/ai-assistant-admin.dto'

/**
 * Assistant-registry admin surface (Track C — ADR-054, Arc F.1) — web role, **SUPER_ADMIN only**.
 * Mirrors `AdminController`'s posture: `@Auth(Bearer)` short-circuits to the JWT branch (an API key
 * fails as a 401 — no key path to admin), `@SystemRoles(SuperAdmin)` gates the role, and every
 * mutation additionally requires step-up freshness (`@RequireFreshAuth`) and a tightened rate bucket.
 * Reads are role-gated but not step-up (no state change). No provider/tool I/O.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/ai/assistants')
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
export class AiAssistantAdminController {
  constructor(private readonly service: AiAssistantAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List assistants (latest-per-slug by default) — SUPER_ADMIN only' })
  @ZodResponse({
    type: AiAssistantListResponseDto,
    status: 200,
    description: 'Paginated assistants',
  })
  list(@Query() query: AiAssistantListQueryDto): Promise<AiAssistantListResponse> {
    return this.service.list(query)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one assistant version — SUPER_ADMIN only' })
  @ZodResponse({ type: AiAssistantResponseDto, status: 200, description: 'Assistant' })
  get(@Param('id') id: string): Promise<AiAssistantResponse> {
    return this.service.get(id)
  }

  @Post()
  @ApiOperation({ summary: 'Create a new assistant (version 1) — SUPER_ADMIN only' })
  @RequireFreshAuth()
  @Throttle({ long: { limit: 20, ttl: 60_000 } })
  @ZodResponse({ type: AiAssistantResponseDto, status: 201, description: 'Created assistant' })
  create(
    @CurrentUser() actor: RequestPrincipal,
    @Body() dto: CreateAiAssistantDto
  ): Promise<AiAssistantResponse> {
    return this.service.create(actor, dto)
  }

  @Post(':slug/versions')
  @ApiOperation({ summary: 'Publish a new immutable assistant version — SUPER_ADMIN only' })
  @RequireFreshAuth()
  @Throttle({ long: { limit: 20, ttl: 60_000 } })
  @ZodResponse({ type: AiAssistantResponseDto, status: 201, description: 'Published version' })
  publishVersion(
    @CurrentUser() actor: RequestPrincipal,
    @Param('slug') slug: string,
    @Body() dto: PublishAiAssistantVersionDto
  ): Promise<AiAssistantResponse> {
    return this.service.publishVersion(actor, slug, dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update assistant enabled/displayName in place — SUPER_ADMIN only' })
  @RequireFreshAuth()
  @Throttle({ long: { limit: 20, ttl: 60_000 } })
  @ZodResponse({ type: AiAssistantResponseDto, status: 200, description: 'Updated assistant' })
  update(
    @CurrentUser() actor: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateAiAssistantDto
  ): Promise<AiAssistantResponse> {
    return this.service.update(actor, id, dto)
  }
}
