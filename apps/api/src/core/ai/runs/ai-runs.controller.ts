import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
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
  @ApiOperation({ summary: 'Queue an AI run on a conversation' })
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
  @ApiOperation({ summary: 'Fetch one owned AI run' })
  @ZodResponse({ type: AiRunResponseDto, status: 200, description: 'Run' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string): Promise<AiRunResponse> {
    return this.runs.getOwned(userId, id)
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an owned AI run (cooperative)' })
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
