import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
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
  @ApiOperation({ summary: 'List owned AI approvals (optionally by state)' })
  @ZodResponse({ type: AiApprovalListResponseDto, status: 200, description: 'Owned approvals' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: AiApprovalListQueryDto
  ): Promise<AiApprovalListResponse> {
    return this.approvals.list(userId, query)
  }

  @Post(':id/decision')
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
