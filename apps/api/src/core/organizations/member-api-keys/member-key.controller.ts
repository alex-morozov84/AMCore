import { Body, Controller, Get, Header, Param, Post, Query, Req } from '@nestjs/common'
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
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'

import {
  AuthType,
  isOrganizationContextId,
  MEMBER_KEY_QUERY_BYTES,
  MEMBER_KEY_REQUEST_BYTES,
  type MemberKeyList,
  type MemberKeyResult,
  ORGANIZATION_CONTEXT_FAMILY,
} from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import { SchemaResponse } from '../../../common/schemas/schema-response.js'
import { Auth } from '../../auth/decorators/auth.decorator.js'
import { RequireTeamAccess } from '../../auth/decorators/require-team-access.decorator.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../../auth/organization-context/request-context-policy.js'

import {
  MemberKeyCommandDto,
  MemberKeyListDto,
  MemberKeyQueryDto,
  MemberKeyResultDto,
} from './member-key.dto.js'
import { CurrentMemberKeyActor, type MemberKeyActor } from './member-key-actor.js'
import { MemberKeyCommandService } from './member-key-command.service.js'
import { MemberKeyQueryService } from './member-key-query.service.js'

function selectors(
  orgId: string,
  userId: string,
  request: { originalUrl: string; rawBody?: Buffer },
  keyId?: string
): void {
  if (![orgId, userId, ...(keyId ? [keyId] : [])].every(isOrganizationContextId))
    throw new AppException('Invalid selector', 400, 'BAD_REQUEST')
  if (
    Buffer.byteLength(request.originalUrl.split('?')[1] ?? '') > MEMBER_KEY_QUERY_BYTES ||
    (request.rawBody?.byteLength ?? 0) > MEMBER_KEY_REQUEST_BYTES
  )
    throw new AppException('Request budget exceeded', 413, 'PAYLOAD_TOO_LARGE')
}
@ApiTags('organizations')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@RequireTeamAccess('orgId')
@OrganizationContextBoundary(ORGANIZATION_CONTEXT_FAMILY)
@ApiParam({ name: 'orgId', description: 'Selected organization ID' })
@ApiParam({ name: 'userId', description: 'Current member user ID' })
@ApiBadRequestResponse({ description: 'Invalid selector, strict DTO or query' })
@ApiUnauthorizedResponse({ description: 'Personal bearer required; API keys rejected' })
@ApiForbiddenResponse({ description: 'Current membership and full TeamAccess required' })
@ApiNotFoundResponse({ description: 'MEMBER_UNAVAILABLE or MEMBER_API_KEY_UNAVAILABLE' })
@ApiConflictResponse({
  description: 'MEMBER_API_KEYS_CONFLICT or MEMBER_API_KEYS_LIMIT; no changes',
})
@ApiPayloadTooLargeResponse({ description: 'Request budget exceeded' })
@ApiServiceUnavailableResponse({
  description: 'Read unavailable or write outcome unconfirmed; inspect before new confirmation',
})
@ApiTooManyRequestsResponse({ description: 'Observe Retry-After; no automatic mutation retry' })
@Controller('organizations/:orgId/members/:userId/api-keys')
export class MemberKeyController {
  constructor(
    private readonly query: MemberKeyQueryService,
    private readonly command: MemberKeyCommandService
  ) {}

  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'List safe keys for one current organization member' })
  @ApiQuery({ name: 'expectedMemberId', required: true, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'unexpired', 'expired', 'revoked'] })
  @SchemaResponse({ type: MemberKeyListDto, status: 200 })
  list(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Query({ schema: MemberKeyQueryDto.schema }) query: MemberKeyQueryDto,
    @Req() request: { originalUrl: string },
    @CurrentMemberKeyActor() actor: MemberKeyActor
  ): Promise<MemberKeyList> {
    selectors(orgId, userId, request)
    return this.query.list(orgId, userId, query, actor)
  }

  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @Post(':keyId/revoke')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Permanently revoke one member key in this organization' })
  @ApiParam({ name: 'keyId', description: 'Key ID belonging to target user and organization' })
  @SchemaResponse({ type: MemberKeyResultDto, status: 200 })
  single(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Param('keyId') keyId: string,
    @Body({ schema: MemberKeyCommandDto.schema }) body: MemberKeyCommandDto,
    @Req() request: { originalUrl: string; rawBody?: Buffer },
    @CurrentMemberKeyActor() actor: MemberKeyActor
  ): Promise<MemberKeyResult> {
    selectors(orgId, userId, request, keyId)
    return this.command.execute(orgId, userId, body, actor, keyId)
  }

  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @Post('revoke-all')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Permanently revoke all current unrevoked member keys; maximum 1000' })
  @SchemaResponse({ type: MemberKeyResultDto, status: 200 })
  all(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body({ schema: MemberKeyCommandDto.schema }) body: MemberKeyCommandDto,
    @Req() request: { originalUrl: string; rawBody?: Buffer },
    @CurrentMemberKeyActor() actor: MemberKeyActor
  ): Promise<MemberKeyResult> {
    selectors(orgId, userId, request)
    return this.command.execute(orgId, userId, body, actor)
  }
}
