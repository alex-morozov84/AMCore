import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import type { Organization, User } from '@prisma/client'

import { SystemRole } from '@amcore/shared'

import { SystemRoles } from '../auth/decorators/system-roles.decorator'

import { AdminService } from './admin.service'
import { UpdateSystemRoleDto } from './dto/update-system-role.dto'

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@SystemRoles(SystemRole.SuperAdmin)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users — SUPER_ADMIN only' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAllUsers(
    @Query('page') page?: number,
    @Query('limit') limit?: number
  ): Promise<{ data: User[]; total: number }> {
    return this.adminService.findAllUsers(page, limit)
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update user system role — SUPER_ADMIN only' })
  updateUserSystemRole(@Param('id') id: string, @Body() dto: UpdateSystemRoleDto): Promise<User> {
    return this.adminService.updateUserSystemRole(id, dto.systemRole)
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
