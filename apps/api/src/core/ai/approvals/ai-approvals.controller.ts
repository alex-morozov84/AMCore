import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
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
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import { type AiApprovalListResponse, type AiApprovalResponse, AuthType } from '@amcore/shared'

import { Auth } from '../../auth/decorators/auth.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import {
  AiApprovalListQueryDto,
  AiApprovalListResponseDto,
  AiApprovalResponseDto,
  DecideAiApprovalDto,
} from '../dto/ai.dto'

import { AiApprovalService } from './ai-approval.service'

/**
 * AI human-in-the-loop approval surface (Track C — ADR-054, Arc E.5), bearer-authenticated and
 * owner-scoped (via the approval's run → conversation). Web role only: it records a decision and
 * re-queues the run — the worker executes the approved tool. Missing/not-owned → 404; a stale/raced or
 * conflicting decision → 409 (an already-recorded same decision is an idempotent 200).
 */
@ApiTags('AI')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@Controller('ai/approvals')
export class AiApprovalsController {
  constructor(private readonly approvals: AiApprovalService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({
    status: 200,
    type: AiApprovalListResponseDto.Output,
    description: 'Owned approvals',
    headers: {
      'Cache-Control': {
        description: 'Owner-specific approval data must not be cached',
        schema: { type: 'string', enum: ['private, no-store'] },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid query' })
  @ApiUnauthorizedResponse({ description: 'Personal bearer required' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  @ApiOperation({ summary: 'List owned AI approvals (optionally by state)' })
  @ZodResponse({ type: AiApprovalListResponseDto, status: 200, description: 'Owned approvals' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: AiApprovalListQueryDto
  ): Promise<AiApprovalListResponse> {
    return this.approvals.list(userId, query)
  }

  @Post(':id/decision')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({
    status: 200,
    type: AiApprovalResponseDto.Output,
    description: 'Approval after the decision',
    headers: {
      'Cache-Control': {
        description: 'Owner-specific approval data must not be cached',
        schema: { type: 'string', enum: ['private, no-store'] },
      },
    },
  })
  @ApiParam({ name: 'id', description: 'Owned approval identifier' })
  @ApiBadRequestResponse({ description: 'Strict decision and displayed intentHash required' })
  @ApiUnauthorizedResponse({ description: 'Personal bearer required' })
  @ApiForbiddenResponse({
    description: 'Current target read and execute rights required for approval',
  })
  @ApiNotFoundResponse({ description: 'Approval unavailable to this owner' })
  @ApiConflictResponse({
    description: 'Hash mismatch, incompatible action, expiry or conflicting decision',
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject an owned pending AI approval' })
  @ZodResponse({
    type: AiApprovalResponseDto,
    status: 200,
    description: 'Approval after the decision',
  })
  decide(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() body: DecideAiApprovalDto
  ): Promise<AiApprovalResponse> {
    return this.approvals.decide(userId, id, body)
  }
}
