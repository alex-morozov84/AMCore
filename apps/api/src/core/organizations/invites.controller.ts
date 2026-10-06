import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ZodResponse, ZodValidationPipe } from 'nestjs-zod'

import { AuthType, ORGANIZATION_CONTEXT_FAMILY, type ReissueInviteInput } from '@amcore/shared'

import { Auth } from '../auth/decorators/auth.decorator'
import { RequireTeamAccess } from '../auth/decorators/require-team-access.decorator'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from '../auth/organization-context/request-context-policy'
import { InvitationRequestGuard } from '../invitations/invitation-request.guard'

import { CreateInviteDto, InviteListResponseDto, InviteResponseDto } from './dto'
import {
  InviteListQueryDto,
  InviteRoleChoicesQueryDto,
  InviteRoleChoicesResponseDto,
  ReissueInviteDto,
  RevokeInviteQueryDto,
} from './dto/invitation-management.dto'
import { CurrentInvitationActor, type InvitationActor } from './invitation-actor'
import { parseInvitationOperationId } from './invitation-operation'
import { InviteService } from './invite.service'

@ApiTags('organizations')
@ApiBearerAuth()
@ApiParam({ name: 'orgId', type: String })
@ApiUnauthorizedResponse({ description: 'Personal bearer authentication required' })
@ApiForbiddenResponse({ description: 'Actual membership and full TeamAccess required' })
@ApiBadRequestResponse({ description: 'Invalid strict request/query/header' })
@ApiNotFoundResponse({ description: 'Organization or invitation unavailable' })
@ApiConflictResponse({ description: 'Generation, settlement or operation conflict' })
@ApiTooManyRequestsResponse({ description: 'Invitation request budget exceeded' })
@ApiServiceUnavailableResponse({ description: 'Read unavailable or command outcome unconfirmed' })
@Controller('organizations/:orgId/invites')
@Auth(AuthType.Bearer)
@OrganizationContextBoundary(ORGANIZATION_CONTEXT_FAMILY)
@RequireTeamAccess('orgId')
@UseGuards(InvitationRequestGuard)
export class InvitesController {
  constructor(private readonly inviteService: InviteService) {}

  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @Get()
  @ApiOperation({ summary: 'List pending/retained expired invitations with complete role intent' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1, maximum: 10000 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'expired', 'all'] })
  @ZodResponse({ type: InviteListResponseDto, status: 200 })
  listInvites(
    @Param('orgId') orgId: string,
    @CurrentInvitationActor() actor: InvitationActor,
    @Query() query: InviteListQueryDto
  ): ReturnType<InviteService['listInvites']> {
    return this.inviteService.listInvites(orgId, actor, query)
  }

  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @Get('role-choices')
  @ApiOperation({
    summary: 'Discover compact assignable roles and complete default MEMBER projection',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number, maximum: 100 })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ZodResponse({ type: InviteRoleChoicesResponseDto, status: 200 })
  roleChoices(
    @Param('orgId') orgId: string,
    @CurrentInvitationActor() actor: InvitationActor,
    @Query() query: InviteRoleChoicesQueryDto
  ): ReturnType<InviteService['roleChoices']> {
    return this.inviteService.roleChoices(orgId, actor, query)
  }

  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Issue an invitation; uniform acknowledgment, no delivery/account disclosure',
  })
  @ApiHeader({
    name: 'X-Invitation-Operation-Id',
    required: true,
    description: 'UUIDv7; first execution within24h, replay30d',
  })
  @ZodResponse({
    type: InviteResponseDto,
    status: 202,
    description: 'Decision committed; email delivery is best-effort',
  })
  create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateInviteDto,
    @CurrentInvitationActor() actor: InvitationActor,
    @Headers('x-invitation-operation-id') operation: string
  ): ReturnType<InviteService['createInvite']> {
    return this.inviteService.createInvite(orgId, dto, actor, parseInvitationOperationId(operation))
  }

  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @Post(':inviteId/reissue')
  @ApiBody({ type: ReissueInviteDto })
  @HttpCode(202)
  @ApiOperation({
    summary: 'Reissue a generation with explicit repeat or complete replacement intent',
  })
  @ApiParam({ name: 'inviteId', type: String })
  @ApiHeader({ name: 'X-Invitation-Operation-Id', required: true })
  @ZodResponse({
    type: InviteResponseDto,
    status: 202,
    description: 'Decision committed; email delivery is best-effort',
  })
  reissue(
    @Param('orgId') orgId: string,
    @Param('inviteId') id: string,
    @Body(new ZodValidationPipe(ReissueInviteDto)) dto: ReissueInviteInput,
    @CurrentInvitationActor() actor: InvitationActor,
    @Headers('x-invitation-operation-id') operation: string
  ): ReturnType<InviteService['reissueInvite']> {
    return this.inviteService.reissueInvite(
      orgId,
      id,
      dto,
      actor,
      parseInvitationOperationId(operation)
    )
  }

  @RequireTeamAccess('orgId')
  @RequestContextPolicy({ kind: 'organization', selector: { param: 'orgId' } })
  @Delete(':inviteId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the expected generation; this never removes membership' })
  @ApiParam({ name: 'inviteId', type: String })
  @ApiQuery({ name: 'expectedGeneration', required: true, type: Number })
  @ApiHeader({ name: 'X-Invitation-Operation-Id', required: true })
  @ApiNoContentResponse({ description: 'Revocation committed; empty body' })
  revokeInvite(
    @Param('orgId') orgId: string,
    @Param('inviteId') id: string,
    @Query() query: RevokeInviteQueryDto,
    @CurrentInvitationActor() actor: InvitationActor,
    @Headers('x-invitation-operation-id') operation: string
  ): ReturnType<InviteService['revokeInvite']> {
    return this.inviteService.revokeInvite(
      orgId,
      id,
      query.expectedGeneration,
      actor,
      parseInvitationOperationId(operation)
    )
  }
}
