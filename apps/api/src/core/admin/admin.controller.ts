import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ZodSerializerDto } from 'nestjs-zod'

import {
  type AdminOrganizationListResponse,
  type AdminUserListResponse,
  type AdminUserResponse,
  AuthType,
  PAGINATION,
  type RequestPrincipal,
  SystemRole,
} from '@amcore/shared'

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto'
import type { CleanupResult } from '../../infrastructure/schedule/cleanup.service'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireFreshAuth } from '../auth/decorators/require-fresh-auth.decorator'
import { SystemRoles } from '../auth/decorators/system-roles.decorator'

import { AdminService } from './admin.service'
import { AdminOrganizationListResponseDto } from './dto/admin-organization-response.dto'
import { AdminUserListResponseDto, AdminUserResponseDto } from './dto/admin-user-response.dto'
import { UpdateSystemRoleDto } from './dto/update-system-role.dto'

/**
 * OA-02: admin routes are bearer-only.
 *
 * `SystemRolesGuard` checks only `request.user.systemRole`, not the
 * credential type or `principal.scopes`. The principal an API key
 * produces inherits `systemRole` from the owning user
 * (`ApiKeyGuard.canActivate` → `apiKey.user.systemRole`), so a
 * SUPER_ADMIN-owned API key with arbitrarily narrow scopes — e.g.
 * `['read:User']` — would otherwise satisfy the system-role check and
 * reach handlers that perform unrestricted Prisma writes. Admin
 * routes also have no `@CheckPolicies`, so the CASL
 * `userPerms ∩ scopes` intersection (AK-09 / Stage 4) is not
 * consulted here at all.
 *
 * `@Auth(AuthType.Bearer)` at the class level short-circuits the
 * auth chain to the JWT branch only; an API key fails the JWT
 * branch as a decision-class 401 (per AK-11 `isDecisionError`).
 *
 * See `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-02 and ADR-033.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Auth(AuthType.Bearer)
@SystemRoles(SystemRole.SuperAdmin)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users — SUPER_ADMIN only' })
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
  @ZodSerializerDto(AdminUserListResponseDto)
  findAllUsers(@Query() pagination: PaginationQueryDto): Promise<AdminUserListResponse> {
    const { page, limit } = pagination
    return this.adminService.findAllUsers(page, limit)
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update user system role — SUPER_ADMIN only' })
  // OB-06b: destructive privileged op — require a recently re-authenticated
  // session (step-up) on top of the OB-06a current-role check.
  @RequireFreshAuth()
  // OB-03: override the global `long` bucket (default 100/min) to
  // 20/min for this privileged operation. Adding a new named
  // bucket in `ThrottlerModule.forRoot` would cap every route in
  // the API at the admin limit (caught in Stage 7 final-e2e), so
  // we narrow the existing `long` bucket per-handler instead.
  @Throttle({ long: { limit: 20, ttl: 60_000 } })
  @ZodSerializerDto(AdminUserResponseDto)
  updateUserSystemRole(
    @CurrentUser() actor: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateSystemRoleDto
  ): Promise<AdminUserResponse> {
    return this.adminService.updateUserSystemRole(id, dto.systemRole, actor)
  }

  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger expired records cleanup — SUPER_ADMIN only' })
  // OB-06b: destructive privileged op — require step-up freshness.
  @RequireFreshAuth()
  // OB-03: heavy DB sweep — override `long` to 5/min for this
  // handler. Same per-handler-override pattern as above.
  @Throttle({ long: { limit: 5, ttl: 60_000 } })
  runCleanup(@CurrentUser() actor: RequestPrincipal): Promise<CleanupResult> {
    return this.adminService.runCleanup(actor)
  }

  @Get('organizations')
  @ApiOperation({ summary: 'List all organizations — SUPER_ADMIN only' })
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
  @ZodSerializerDto(AdminOrganizationListResponseDto)
  findAllOrganizations(
    @Query() pagination: PaginationQueryDto
  ): Promise<AdminOrganizationListResponse> {
    const { page, limit } = pagination
    return this.adminService.findAllOrganizations(page, limit)
  }
}
