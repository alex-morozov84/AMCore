import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import {
  Action,
  AuthType,
  type OrgRoleResponse,
  PAGINATION,
  type PermissionResponse,
  type RequestPrincipal,
  type RoleListResponse,
  Subject,
} from '@amcore/shared'

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto'
import { Auth } from '../auth/decorators/auth.decorator'
import { CheckPolicies } from '../auth/decorators/check-policies.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import {
  AssignPermissionDto,
  CreateRoleDto,
  OrgRoleResponseDto,
  PermissionResponseDto,
  UpdateRoleDto,
} from './dto'
import { RoleListResponseDto } from './dto/organization-list-response.dto'
import { RoleService } from './role.service'

/**
 * Class-level `@Auth(AuthType.Bearer, AuthType.ApiKey)` is an explicit
 * dual-auth opt-in registered in ADR-034's allowlist (runtime default
 * after Stage 1c is `[AuthType.Bearer]`). API keys may manage org
 * roles subject to the CASL `userPerms ∩ scopes` model; the
 * per-handler `@CheckPolicies` decorators are the actual authorization
 * gate.
 *
 * The ADR-034 allowlist in `auth-decorator-coverage.spec.ts` enumerates
 * each handler in this controller individually — adding a new handler
 * also requires an allowlist entry (via ADR amendment) for the
 * metadata test to pass. See `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-11.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations/:orgId/roles')
@Auth(AuthType.Bearer, AuthType.ApiKey)
export class RolesController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'List all roles in the organization — ADMIN only' })
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
  @ZodResponse({ type: RoleListResponseDto, status: 200, description: 'Paginated roles' })
  listRoles(
    @Param('orgId') orgId: string,
    @CurrentUser() principal: RequestPrincipal,
    @Query() pagination: PaginationQueryDto
  ): Promise<RoleListResponse> {
    return this.roleService.listRoles(orgId, principal, pagination.page, pagination.limit)
  }

  @Post()
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Create a custom role — ADMIN only' })
  @ZodResponse({ type: OrgRoleResponseDto, status: 201, description: 'Role created' })
  createRole(
    @Param('orgId') orgId: string,
    @Body() dto: CreateRoleDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<OrgRoleResponse> {
    return this.roleService.createRole(orgId, dto, principal)
  }

  @Patch(':roleId')
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Update a custom role — ADMIN only' })
  @ZodResponse({ type: OrgRoleResponseDto, status: 200, description: 'Updated role' })
  updateRole(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<OrgRoleResponse> {
    return this.roleService.updateRole(orgId, roleId, dto, principal)
  }

  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Delete a custom role — ADMIN only (system roles cannot be deleted)' })
  @ApiNoContentResponse({ description: 'Role deleted' })
  deleteRole(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<void> {
    return this.roleService.deleteRole(orgId, roleId, principal)
  }

  @Post(':roleId/permissions')
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Assign a CASL permission to a custom role — ADMIN only' })
  @ZodResponse({ type: PermissionResponseDto, status: 201, description: 'Permission assigned' })
  assignPermission(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @Body() dto: AssignPermissionDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<PermissionResponse> {
    return this.roleService.assignPermission(orgId, roleId, dto, principal)
  }

  @Delete(':roleId/permissions/:permId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Remove a permission from a custom role — ADMIN only' })
  @ApiNoContentResponse({ description: 'Permission removed' })
  removePermission(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @Param('permId') permId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<void> {
    return this.roleService.removePermission(orgId, roleId, permId, principal)
  }
}
