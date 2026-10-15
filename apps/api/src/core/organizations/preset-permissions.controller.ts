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

import {
  AuthType,
  ORGANIZATION_CONTEXT_FAMILY,
  type PermissionResponse,
  type RequestPrincipal,
} from '@amcore/shared'

import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { Auth } from '../auth/decorators/auth.decorator.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy.js'

import { CapabilityRegistry } from './capability-registry.service.js'
import { CreatePresetPermissionDto } from './dto/capability.dto.js'
import { PermissionResponseDto } from './dto/index.js'
import { RoleService } from './role.service.js'

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
  @SchemaResponse({ type: PermissionResponseDto, status: 201, description: 'Permission assigned' })
  assign(
    @Param('orgId') orgId: string,
    @Param('roleId') roleId: string,
    @Body({ schema: CreatePresetPermissionDto.schema }) body: CreatePresetPermissionDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<PermissionResponse> {
    return this.roles.assignPermission(orgId, roleId, this.registry.preset(body), principal)
  }
}
