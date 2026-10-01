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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import { ORGANIZATION_CONTEXT_FAMILY } from '@amcore/shared'
import {
  AuthType,
  type OrgRoleResponse,
  PAGINATION,
  type PermissionResponse,
  type RequestPrincipal,
  type RoleListResponse,
} from '@amcore/shared'

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'

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
 * per-handler `@RequireTeamAccess` decorators are the actual authorization
 * gate.
 *
 * The ADR-034 allowlist in `auth-decorator-coverage.spec.ts` enumerates
 * each handler in this controller individually — adding a new handler
 * also requires an allowlist entry (via ADR amendment) for the
 * metadata test to pass. See `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-11.
 *
 * `@ApiSecurity('apiKeyBearer')` (Swagger-visible counterpart of the
 * allowlist) is applied per-handler rather than at class level, matching
 * the convention in `organizations.controller.ts` — `@nestjs/swagger`
 * concatenates class + method `security` arrays rather than allowing a
 * method to opt out, so per-handler application is the only pattern that
 * stays safe if a future handler here ever needs a bearer-only override.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid accepted credential' })
@ApiForbiddenResponse({
  description: 'FORBIDDEN: target, record/field or full TeamAccess authority denied',
})
@Controller('organizations/:orgId/roles')
@Auth(AuthType.Bearer, AuthType.ApiKey)
@OrganizationContextBoundary(ORGANIZATION_CONTEXT_FAMILY)
export class RolesController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({ summary: 'List all roles in the organization — requires full TeamAccess' })
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
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  listRoles(
    @Param('orgId') orgId: string,
    @CurrentUser() principal: RequestPrincipal,
    @Query() pagination: PaginationQueryDto
  ): Promise<RoleListResponse> {
    return this.roleService.listRoles(orgId, principal, pagination.page, pagination.limit)
  }

  @Post()
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({ summary: 'Create a custom role — requires full TeamAccess' })
  @ZodResponse({ type: OrgRoleResponseDto, status: 201, description: 'Role created' })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  createRole(
    @Param('orgId') orgId: string,
    @Body() dto: CreateRoleDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<OrgRoleResponse> {
    return this.roleService.createRole(orgId, dto, principal)
  }

  @Patch(':roleId')
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({ summary: 'Update a custom role — requires full TeamAccess' })
  @ZodResponse({ type: OrgRoleResponseDto, status: 200, description: 'Updated role' })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
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
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({
    summary: 'Delete a custom role — requires full TeamAccess (system roles cannot be deleted)',
  })
  @ApiNoContentResponse({ description: 'Role deleted' })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  deleteRole(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<void> {
    return this.roleService.deleteRole(orgId, roleId, principal)
  }

  @Post(':roleId/permissions')
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({ summary: 'Assign a CASL permission to a custom role — requires full TeamAccess' })
  @ZodResponse({ type: PermissionResponseDto, status: 201, description: 'Permission assigned' })
  @ApiBadRequestResponse({
    description:
      'Validation error or unsupported condition, field or identity placeholder (PERMISSION_RULE_UNSUPPORTED, PERMISSION_FIELD_UNSUPPORTED, PERMISSION_PLACEHOLDER_UNSUPPORTED)',
  })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
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
  @RequireTeamAccess('orgId')
  @ApiSecurity('apiKeyBearer')
  @ApiOperation({ summary: 'Remove a permission from a custom role — requires full TeamAccess' })
  @ApiNoContentResponse({ description: 'Permission removed' })
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  removePermission(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @Param('permId') permId: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<void> {
    return this.roleService.removePermission(orgId, roleId, permId, principal)
  }
}
