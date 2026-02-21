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
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Permission, Role } from '@prisma/client'

import { Action, type RequestPrincipal, Subject } from '@amcore/shared'

import { CheckPolicies } from '../auth/decorators/check-policies.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import { AssignPermissionDto, CreateRoleDto, UpdateRoleDto } from './dto'
import type { RoleWithPermissions } from './role.service'
import { RoleService } from './role.service'

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations/:orgId/roles')
export class RolesController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'List all roles in the organization — ADMIN only' })
  listRoles(@Param('orgId') orgId: string): Promise<RoleWithPermissions[]> {
    return this.roleService.listRoles(orgId)
  }

  @Post()
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Create a custom role — ADMIN only' })
  createRole(
    @Param('orgId') orgId: string,
    @Body() dto: CreateRoleDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<Role> {
    return this.roleService.createRole(orgId, dto, principal)
  }

  @Patch(':roleId')
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Update a custom role — ADMIN only' })
  updateRole(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<Role> {
    return this.roleService.updateRole(orgId, roleId, dto, principal)
  }

  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Delete a custom role — ADMIN only (system roles cannot be deleted)' })
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
  assignPermission(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @Body() dto: AssignPermissionDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<Permission> {
    return this.roleService.assignPermission(orgId, roleId, dto, principal)
  }

  @Delete(':roleId/permissions/:permId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckPolicies((ability) => ability.can(Action.Manage, Subject.Organization))
  @ApiOperation({ summary: 'Remove a permission from a custom role — ADMIN only' })
  removePermission(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @Param('permId') permId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<void> {
    return this.roleService.removePermission(orgId, roleId, permId, principal)
  }
}
