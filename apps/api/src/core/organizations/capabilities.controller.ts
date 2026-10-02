import { Controller, Get, Param } from '@nestjs/common'
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
  type CapabilityCatalogueResponse,
  ORGANIZATION_CONTEXT_FAMILY,
} from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'

import { CapabilityRegistry } from './capability-registry.service'
import { CapabilityCatalogueResponseDto } from './dto/capability.dto'

@ApiTags('organizations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer credential required' })
@ApiForbiddenResponse({ description: 'Full team access required' })
@ApiNotFoundResponse({ description: 'Organization missing or inaccessible' })
@Controller('organizations/:orgId/capabilities')
@Auth(AuthType.Bearer)
@OrganizationContextBoundary(ORGANIZATION_CONTEXT_FAMILY)
export class CapabilitiesController {
  constructor(private readonly registry: CapabilityRegistry) {}

  @Get()
  @RequireTeamAccess('orgId')
  @RequestContextPolicy({
    kind: 'organization',
    selector: { param: 'orgId' },
    legacyPlatformMembershipBypass: true,
  })
  @ApiOperation({ summary: 'Discover implemented authorization capabilities for role authoring' })
  @ApiParam({ name: 'orgId', description: 'Selected organization ID' })
  @ApiBadRequestResponse({ description: 'Malformed or conflicting organization selector' })
  @ZodResponse({
    type: CapabilityCatalogueResponseDto,
    status: 200,
    description: 'Implemented capability and preset metadata; no grants',
  })
  catalogue(@Param('orgId') _orgId: string): CapabilityCatalogueResponse {
    return this.registry.catalogue()
  }
}
