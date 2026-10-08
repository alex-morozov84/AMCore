import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import {
  type AiRunCancelResponse,
  type AiRunPage,
  type AiRunResponse,
  AuthType,
} from '@amcore/shared'

import { BadRequestException } from '../../../common/exceptions'
import { Auth } from '../../auth/decorators/auth.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import {
  AiRunCancelResponseDto,
  AiRunListQueryDto,
  AiRunPageDto,
  AiRunResponseDto,
  CreateAiRunDto,
} from '../dto/ai.dto'

import { AiRunService } from './ai-run.service'
import { InvalidAiRunCursorError } from './ai-run-cursor'
import { AiRunProducerService } from './ai-run-producer.service'

/**
 * AI durable-run surface (Track C — ADR-054, Arc C), bearer-authenticated and owner-scoped (via the
 * run's conversation). Web role only: `POST` queues a run, it does not execute it — the worker runs
 * it in Arc C.4. The status SSE stream lands in C.5.
 */
@ApiTags('AI')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@Controller('ai/runs')
export class AiRunsController {
  constructor(
    private readonly producer: AiRunProducerService,
    private readonly runs: AiRunService
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Queue an AI run on a conversation',
    description:
      'Creates a durable run and returns it; the worker executes it. With an `idempotencyKey` the request is idempotent per conversation: repeating it with the SAME input returns the original run and creates nothing, while the same key with a DIFFERENT input is rejected with `AI_RUN_IDEMPOTENCY_CONFLICT`. Every run gets an immutable server-side lifetime (`AI_RUN_DEADLINE_MS`, default 48 h) counted from creation, including queue time, retries and approval waits.',
  })
  @ApiResponse({
    status: 404,
    description: 'The conversation does not exist or is not owned by the caller',
  })
  @ApiResponse({
    status: 409,
    description:
      '`AI_RUN_IDEMPOTENCY_CONFLICT` (the idempotency key was already used for a different request) or the conversation is under human control / closed',
  })
  @ApiResponse({
    status: 503,
    description:
      'No AI model is configured (`model_not_configured`), or bounded catalogue selection is temporarily unavailable (`catalogue_unavailable`)',
  })
  @ZodResponse({ type: AiRunResponseDto, status: 201, description: 'Queued (or replayed) run' })
  create(@CurrentUser('sub') userId: string, @Body() body: CreateAiRunDto): Promise<AiRunResponse> {
    return this.producer.create(userId, body)
  }

  @Get()
  @ApiOperation({ summary: 'Cursor-paginated list of owned AI runs' })
  @ZodResponse({ type: AiRunPageDto, status: 200, description: 'Run page' })
  async list(
    @CurrentUser('sub') userId: string,
    @Query() query: AiRunListQueryDto
  ): Promise<AiRunPage> {
    try {
      return await this.runs.list(userId, query)
    } catch (error) {
      if (error instanceof InvalidAiRunCursorError) throw new BadRequestException(error.message)
      throw error
    }
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Fetch one owned AI run',
    description:
      'Returns durable state and bounded reason/error codes. Execution may refuse model_snapshot_legacy_unsupported, model_snapshot_invalid, model_binding_changed, assistant_binding_changed, provider_retry_restriction_invalid or provider_retry_after_exceeds_horizon. Retry restrictions and provider receipts are internal and are not exposed by this response.',
  })
  @ZodResponse({ type: AiRunResponseDto, status: 200, description: 'Run' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string): Promise<AiRunResponse> {
    return this.runs.getOwned(userId, id)
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an owned AI run (cooperative)',
    description:
      'Decided under the run lock, so a cancel is never lost to a racing approval or park. A queued run is cancelled at once; a run waiting for approval is cancelled and its pending approval voided; a RUNNING run records `cancellationRequested` and the worker stops before its next provider call or tool start — the status stays `running` until it does (an in-flight provider call or tool is not aborted, so the delay is bounded by its timeout); a finished run is an idempotent no-op.',
  })
  @ApiResponse({ status: 404, description: 'The run does not exist or is not owned by the caller' })
  @ZodResponse({
    type: AiRunCancelResponseDto,
    status: 200,
    description: 'Run status after cancel',
  })
  cancel(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string
  ): Promise<AiRunCancelResponse> {
    return this.runs.cancel(userId, id)
  }
}
