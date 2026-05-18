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
import type { Organization } from '@prisma/client'
import { ZodSerializerDto } from 'nestjs-zod'

import {
  type AdminUserListResponse,
  type AdminUserResponse,
  AuthType,
  SystemRole,
} from '@amcore/shared'

import type { CleanupResult } from '../../infrastructure/schedule/cleanup.service'
import { Auth } from '../auth/decorators/auth.decorator'
import { SystemRoles } from '../auth/decorators/system-roles.decorator'

import { AdminService } from './admin.service'
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
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ZodSerializerDto(AdminUserListResponseDto)
  findAllUsers(
    @Query('page') page?: number,
    @Query('limit') limit?: number
  ): Promise<AdminUserListResponse> {
    return this.adminService.findAllUsers(page, limit)
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update user system role — SUPER_ADMIN only' })
  @ZodSerializerDto(AdminUserResponseDto)
  updateUserSystemRole(
    @Param('id') id: string,
    @Body() dto: UpdateSystemRoleDto
  ): Promise<AdminUserResponse> {
    return this.adminService.updateUserSystemRole(id, dto.systemRole)
  }

  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger expired records cleanup — SUPER_ADMIN only' })
  runCleanup(): Promise<CleanupResult> {
    return this.adminService.runCleanup()
  }

  @Get('organizations')
  @ApiOperation({ summary: 'List all organizations — SUPER_ADMIN only' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAllOrganizations(
    @Query('page') page?: number,
    @Query('limit') limit?: number
  ): Promise<{ data: Organization[]; total: number }> {
    return this.adminService.findAllOrganizations(page, limit)
  }
}
