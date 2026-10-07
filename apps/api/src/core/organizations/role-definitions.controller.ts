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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import {
  AuthType,
  type DeleteRoleDefinitionResponse,
  isOrganizationContextId,
  ORGANIZATION_CONTEXT_FAMILY,
  type RequestPrincipal,
  type RoleDefinitionDetail,
  RoleDefinitionErrorCode,
  type RoleDefinitionListResponse,
  type SaveRoleDefinitionResponse,
} from '@amcore/shared'

import { AppException } from '../../common/exceptions'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'

import {
  CreateRoleDefinitionDto,
  DeleteRoleDefinitionDto,
  DeleteRoleDefinitionResponseDto,
  RoleDefinitionDetailDto,
  RoleDefinitionListQueryDto,
  RoleDefinitionListResponseDto,
  SaveRoleDefinitionDto,
  SaveRoleDefinitionResponseDto,
} from './dto/role-definition.dto'
import { RoleDefinitionCommandService } from './role-definition-command.service'
import { RoleDefinitionQueryService } from './role-definition-query.service'

const unavailable = (): never => {
  throw new AppException(
    'Role unavailable',
    HttpStatus.NOT_FOUND,
    RoleDefinitionErrorCode.ROLE_UNAVAILABLE
  )
}
const roleId = (value: string): string => (isOrganizationContextId(value) ? value : unavailable())

/**
 * Role-definition editor contracts. Bearer-only, current organization membership (even for
 * SUPER_ADMIN) and full TeamAccess; API keys are refused. Legacy `/roles*` routes are unchanged.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer credential required' })
@ApiForbiddenResponse({ description: 'Current membership and full TeamAccess required' })
@ApiParam({ name: 'orgId', description: 'Current organization membership selector' })
@Controller('organizations/:orgId/role-definitions')
@Auth(AuthType.Bearer)
@OrganizationContextBoundary(ORGANIZATION_CONTEXT_FAMILY)
export class RoleDefinitionsController {
  constructor(
    private readonly queries: RoleDefinitionQueryService,
    private readonly commands: RoleDefinitionCommandService
  ) {}

  @Get()
  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @ApiOperation({ summary: 'List role definitions with holder counts and rule summaries' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Default 1; bounded offset',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Default 20, maximum 100',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Literal role-name contains; maximum 100 Unicode code points',
  })
  @ApiBadRequestResponse({ description: 'Invalid query or selector' })
  @ApiServiceUnavailableResponse({ description: 'ROLE_READ_UNAVAILABLE: read budget exceeded' })
  @ZodResponse({ type: RoleDefinitionListResponseDto, status: 200 })
  list(
    @Param('orgId') orgId: string,
    @Query() query: RoleDefinitionListQueryDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<RoleDefinitionListResponse> {
    return this.queries.list(orgId, principal.organizationId, query)
  }

  @Get(':roleId')
  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @ApiOperation({ summary: 'Read one role definition as a single atomic snapshot' })
  @ApiParam({
    name: 'roleId',
    description: 'Custom or builtin role ID assignable in the organization',
  })
  @ApiNotFoundResponse({ description: 'ROLE_UNAVAILABLE: missing, foreign or unassignable role' })
  @ApiServiceUnavailableResponse({ description: 'ROLE_READ_UNAVAILABLE: read budget exceeded' })
  @ZodResponse({ type: RoleDefinitionDetailDto, status: 200 })
  detail(
    @Param('orgId') orgId: string,
    @Param('roleId') id: string,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<RoleDefinitionDetail> {
    return this.queries.detail(orgId, roleId(id), principal)
  }

  @Post()
  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @ApiOperation({ summary: 'Create an empty custom role' })
  @ApiBadRequestResponse({ description: 'Invalid body or ROLE_NAME_RESERVED' })
  @ApiConflictResponse({ description: 'ROLE_NAME_CONFLICT: a role with this name exists' })
  @ApiPayloadTooLargeResponse({ description: 'Request body exceeds 16384 decoded bytes' })
  @ApiServiceUnavailableResponse({
    description: 'ROLE_SAVE_UNAVAILABLE: outcome unconfirmed, never replayed',
  })
  @ZodResponse({ type: RoleDefinitionDetailDto, status: 201 })
  create(
    @Param('orgId') orgId: string,
    @Body() body: CreateRoleDefinitionDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<RoleDefinitionDetail> {
    return this.commands.create(orgId, body, principal)
  }

  @Patch(':roleId')
  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @ApiOperation({
    summary: 'Save a complete role definition (metadata and managed presets) atomically',
  })
  @ApiParam({ name: 'roleId', description: 'Custom role ID' })
  @ApiBadRequestResponse({
    description:
      'Invalid body, CAPABILITY_UNSUPPORTED, ROLE_NAME_RESERVED, ROLE_FULL_CONTROL_ACK_REQUIRED or ROLE_SELF_HELD_ACK_REQUIRED',
  })
  @ApiNotFoundResponse({ description: 'ROLE_UNAVAILABLE' })
  @ApiConflictResponse({
    description:
      'ROLE_DEFINITION_CONFLICT (stale revision), ROLE_NAME_CONFLICT or ROLE_DEFINITION_OVERSIZED',
  })
  @ApiPayloadTooLargeResponse({ description: 'Request body exceeds 16384 decoded bytes' })
  @ApiServiceUnavailableResponse({
    description: 'ROLE_SAVE_UNAVAILABLE: outcome unconfirmed, never replayed',
  })
  @ZodResponse({ type: SaveRoleDefinitionResponseDto, status: 200 })
  save(
    @Param('orgId') orgId: string,
    @Param('roleId') id: string,
    @Body() body: SaveRoleDefinitionDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<SaveRoleDefinitionResponse> {
    return this.commands.save(orgId, roleId(id), body, principal)
  }

  @Post(':roleId/deletion')
  @HttpCode(HttpStatus.OK)
  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @ApiOperation({
    summary: 'Delete a custom role after confirming the holders and pending invitations affected',
  })
  @ApiParam({ name: 'roleId', description: 'Custom role ID' })
  @ApiBadRequestResponse({ description: 'Invalid body or ROLE_SELF_HELD_ACK_REQUIRED' })
  @ApiNotFoundResponse({ description: 'ROLE_UNAVAILABLE' })
  @ApiConflictResponse({
    description: 'ROLE_DEFINITION_CONFLICT (stale revision) or ROLE_DELETE_IMPACT_CHANGED',
  })
  @ApiPayloadTooLargeResponse({ description: 'Request body exceeds 16384 decoded bytes' })
  @ApiServiceUnavailableResponse({
    description: 'ROLE_SAVE_UNAVAILABLE: outcome unconfirmed, never replayed',
  })
  @ZodResponse({ type: DeleteRoleDefinitionResponseDto, status: 200 })
  remove(
    @Param('orgId') orgId: string,
    @Param('roleId') id: string,
    @Body() body: DeleteRoleDefinitionDto,
    @CurrentUser() principal: RequestPrincipal
  ): Promise<DeleteRoleDefinitionResponse> {
    return this.commands.remove(orgId, roleId(id), body, principal)
  }
}
