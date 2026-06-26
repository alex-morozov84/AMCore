import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import { type AiRunResponse, AuthType } from '@amcore/shared'

import { Auth } from '../../auth/decorators/auth.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import { AiRunResponseDto, CreateAiRunDto } from '../dto/ai.dto'

import { AiRunService } from './ai-run.service'
import { AiRunProducerService } from './ai-run-producer.service'

/**
 * AI durable-run surface (Track C — ADR-054, Arc C), bearer-authenticated and owner-scoped (via the
 * run's conversation). Web role only: `POST` queues a run, it does not execute it — the worker runs
 * it in Arc C.4. List/cancel land in C.2; the status SSE stream in C.5.
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

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one owned AI run' })
  @ZodResponse({ type: AiRunResponseDto, status: 200, description: 'Run' })
  get(@CurrentUser('sub') userId: string, @Param('id') id: string): Promise<AiRunResponse> {
    return this.runs.getOwned(userId, id)
  }
}
