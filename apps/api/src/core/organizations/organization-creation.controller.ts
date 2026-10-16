import { Controller, Get, Header, Param } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'

import { AuthType, ORGANIZATION_CONTEXT_FAMILY } from '@amcore/shared'

import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { Auth } from '../auth/decorators/auth.decorator.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy.js'

import {
  OrganizationCreationPolicyDto,
  OrganizationCreationResultDto,
} from './dto/organization-establishment.dto.js'
import { OrganizationCreationService } from './organization-creation.service.js'

@ApiTags('organizations')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Personal bearer JWT required; API keys rejected' })
@Controller('organizations')
@Auth(AuthType.Bearer)
@OrganizationContextBoundary(ORGANIZATION_CONTEXT_FAMILY)
export class OrganizationCreationController {
  constructor(private readonly creation: OrganizationCreationService) {}

  @Get('creation-policy')
  @Header('Cache-Control', 'private, no-store')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({ summary: 'Read the independent self-service organization creation policy' })
  @SchemaResponse({ type: OrganizationCreationPolicyDto, status: 200 })
  policy(): OrganizationCreationPolicyDto {
    return this.creation.policy()
  }

  @Get('creation-results/:operationId')
  @Header('Cache-Control', 'private, no-store')
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Resolve the current actor’s committed organization creation result',
    description:
      '404 does not prove an in-flight request rolled back. Retry only the same operation and input.',
  })
  @ApiParam({
    name: 'operationId',
    format: 'uuid',
    description: 'Original UUIDv4 creation identity',
  })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST: invalid operation ID' })
  @ApiResponse({ status: 404, description: 'ORGANIZATION_CREATION_RESULT_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'ORGANIZATION_CREATION_RESULT_CHANGED: original identity/grant changed',
  })
  @ApiResponse({ status: 503, description: 'ORGANIZATION_CREATION_UNCONFIRMED' })
  @SchemaResponse({ type: OrganizationCreationResultDto, status: 200 })
  result(
    @CurrentUser('sub') actorId: string,
    @Param('operationId') operationId: string
  ): Promise<OrganizationCreationResultDto> {
    return this.creation.result(actorId, operationId)
  }
}
