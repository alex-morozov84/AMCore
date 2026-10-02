import { Body, Controller, Param, Post } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import {
  AuthType,
  ORGANIZATION_CONTEXT_FAMILY,
  type PermissionResponse,
  type RequestPrincipal,
} from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'

import { CapabilityRegistry } from './capability-registry.service'
import { PermissionResponseDto } from './dto'
import { CreatePresetPermissionDto } from './dto/capability.dto'
import { RoleService } from './role.service'

@ApiTags('organizations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer credential required' })
@ApiForbiddenResponse({ description: 'Full team access required' })
@ApiNotFoundResponse({ description: 'Organization or custom role missing' })
@Controller('organizations/:orgId/roles/:roleId/permissions/presets')
@Auth(AuthType.Bearer)
@OrganizationContextBoundary(ORGANIZATION_CONTEXT_FAMILY)
export class PresetPermissionsController {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly roles: RoleService
  ) {}

  @Post()
  @RequireTeamAccess('orgId')
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  @ApiOperation({ summary: 'Assign a declared permission preset to a custom role' })
  @ApiParam({ name: 'orgId', description: 'Selected organization ID' })
  @ApiParam({ name: 'roleId', description: 'Custom role ID in that organization' })
  @ApiBadRequestResponse({
    description:
      'Unsupported capability/preset (CAPABILITY_UNSUPPORTED) or invalid generated rule (PERMISSION_RULE_UNSUPPORTED, PERMISSION_FIELD_UNSUPPORTED, PERMISSION_PLACEHOLDER_UNSUPPORTED)',
  })
  @ZodResponse({ type: PermissionResponseDto, status: 201, description: 'Permission assigned' })
  assign(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @Body() body: CreatePresetPermissionDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<PermissionResponse> {
    return this.roles.assignPermission(orgId, roleId, this.registry.preset(body), principal)
  }
}
