import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import {
  type AiAssistantListResponse,
  type AiAssistantResponse,
  AuthType,
  type RequestPrincipal,
  SystemRole,
} from '@amcore/shared'

import { ApiQuerySchema } from '../../../common/schemas/api-query-schema.js'
import { SchemaResponse } from '../../../common/schemas/schema-response.js'
import { RATE_LIMIT_POLICIES, RateLimit } from '../../../infrastructure/throttling/index.js'
import { Auth } from '../../auth/decorators/auth.decorator.js'
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js'
import { RequireFreshAuth } from '../../auth/decorators/require-fresh-auth.decorator.js'
import { SystemRoles } from '../../auth/decorators/system-roles.decorator.js'

import { AiAssistantAdminService } from './ai-assistant-admin.service.js'
import {
  AiAssistantListQueryDto,
  AiAssistantListResponseDto,
  AiAssistantResponseDto,
  CreateAiAssistantDto,
  PublishAiAssistantVersionDto,
  UpdateAiAssistantDto,
} from './dto/ai-assistant-admin.dto.js'

/**
 * Assistant-registry admin surface (Track C — ADR-054, Arc F.1) — web role, **SUPER_ADMIN only**.
 * Mirrors `AdminController`'s posture: `@Auth(Bearer)` short-circuits to the JWT branch (an API key
 * fails as a 401 — no key path to admin), `@SystemRoles(SuperAdmin)` gates the role, and every
 * mutation additionally requires step-up freshness (`@RequireFreshAuth`) and a tightened rate bucket.
 * Reads are role-gated but not step-up (no state change). No provider/tool I/O.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ApiResponse({ status: 403, description: 'Current SUPER_ADMIN role required' })
@Controller('admin/ai/assistants')
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
export class AiAssistantAdminController {
  constructor(private readonly service: AiAssistantAdminService) {}

  @Get()
  @ApiQuerySchema(AiAssistantListQueryDto.schema)
  @ApiResponse({ status: 400, description: 'Invalid assistant list query.' })
  @ApiOperation({ summary: 'List assistants (latest-per-slug by default) — SUPER_ADMIN only' })
  @SchemaResponse({
    type: AiAssistantListResponseDto,
    status: 200,
    description: 'Paginated assistants',
  })
  list(@Query({ schema: AiAssistantListQueryDto.schema }) query: AiAssistantListQueryDto): Promise<AiAssistantListResponse> {
    return this.service.list(query)
  }

  @Get(':id')
  @ApiResponse({ status: 404, description: 'The assistant version does not exist.' })
  @ApiOperation({ summary: 'Fetch one assistant version — SUPER_ADMIN only' })
  @SchemaResponse({ type: AiAssistantResponseDto, status: 200, description: 'Assistant' })
  get(@Param('id') id: string): Promise<AiAssistantResponse> {
    return this.service.get(id)
  }

  @Post()
  @ApiResponse({ status: 403, description: 'Current SUPER_ADMIN role and recent authentication required' })
  @ApiResponse({ status: 409, description: 'An assistant with this slug already exists.' })
  @ApiOperation({ summary: 'Create a new assistant (version 1) — SUPER_ADMIN only' })
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @SchemaResponse({ type: AiAssistantResponseDto, status: 201, description: 'Created assistant' })
  create(
    @CurrentUser() actor: RequestPrincipal,
    @Body({ schema: CreateAiAssistantDto.schema }) dto: CreateAiAssistantDto
  ): Promise<AiAssistantResponse> {
    return this.service.create(actor, dto)
  }

  @Post(':slug/versions')
  @ApiResponse({ status: 403, description: 'Current SUPER_ADMIN role and recent authentication required' })
  @ApiResponse({ status: 404, description: 'The assistant slug does not exist.' })
  @ApiResponse({ status: 409, description: 'The next version was published concurrently.' })
  @ApiOperation({ summary: 'Publish a new immutable assistant version — SUPER_ADMIN only' })
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @SchemaResponse({ type: AiAssistantResponseDto, status: 201, description: 'Published version' })
  publishVersion(
    @CurrentUser() actor: RequestPrincipal,
    @Param('slug') slug: string,
    @Body({ schema: PublishAiAssistantVersionDto.schema }) dto: PublishAiAssistantVersionDto
  ): Promise<AiAssistantResponse> {
    return this.service.publishVersion(actor, slug, dto)
  }

  @Patch(':id')
  @ApiResponse({ status: 403, description: 'Current SUPER_ADMIN role and recent authentication required' })
  @ApiResponse({ status: 404, description: 'The assistant version does not exist.' })
  @ApiOperation({ summary: 'Update assistant enabled/displayName in place — SUPER_ADMIN only' })
  @ApiResponse({ status: 400, description: 'Provide at least one of enabled or displayName.' })
  @RequireFreshAuth()
  @RateLimit(RATE_LIMIT_POLICIES.PRIVILEGED_MUTATION)
  @SchemaResponse({ type: AiAssistantResponseDto, status: 200, description: 'Updated assistant' })
  update(
    @CurrentUser() actor: RequestPrincipal,
    @Param('id') id: string,
    @Body({ schema: UpdateAiAssistantDto.schema }) dto: UpdateAiAssistantDto
  ): Promise<AiAssistantResponse> {
    return this.service.update(actor, id, dto)
  }
}
