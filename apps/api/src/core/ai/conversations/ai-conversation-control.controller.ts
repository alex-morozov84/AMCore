import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import {
  AI_OPERATOR_REASON_HEADER,
  type AiConversationResponse,
  type AiMessageResponse,
  type AiTranscriptResponse,
  AuthType,
  type RequestPrincipal,
} from '@amcore/shared'

import { Auth } from '../../auth/decorators/auth.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import {
  AiConversationResponseDto,
  AiMessageResponseDto,
  AiTranscriptQueryDto,
  AiTranscriptResponseDto,
  PostOperatorMessageDto,
  ReleaseConversationDto,
  TakeoverConversationDto,
} from '../dto/ai.dto'

import { AiConversationOperatorService } from './ai-conversation-operator.service'

/**
 * Human takeover / release surface (Track C — ADR-054, Arc F.3) — web role, **bearer-only** (the
 * class-level `@Auth(Bearer)` pins the JWT branch, so an API key fails as a 401; API keys never drive
 * takeover). Access is the conversation **owner** OR a cross-user **SUPER_ADMIN operator** — resolved
 * with a 404 no-leak in the service, which also enforces step-up freshness + a bounded reason for the
 * cross-user operator only. Transcript read + operator-message land in Arc F.3b.
 */
@ApiTags('AI')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@Controller('ai/conversations')
export class AiConversationControlController {
  constructor(private readonly operator: AiConversationOperatorService) {}

  @Post(':id/takeover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take human control of a conversation (owner or SUPER_ADMIN operator)' })
  @ZodResponse({ type: AiConversationResponseDto, status: 200, description: 'Taken over' })
  takeover(
    @CurrentUser() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: TakeoverConversationDto
  ): Promise<AiConversationResponse> {
    return this.operator.takeover(principal, id, dto.reason ?? undefined)
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release control back to the assistant (holder or owner)' })
  @ZodResponse({ type: AiConversationResponseDto, status: 200, description: 'Released' })
  release(
    @CurrentUser() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: ReleaseConversationDto
  ): Promise<AiConversationResponse> {
    return this.operator.release(principal, id, dto.reason ?? undefined)
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Read a conversation transcript (owner or SUPER_ADMIN operator)' })
  @ApiHeader({
    name: AI_OPERATOR_REASON_HEADER,
    required: false,
    description: 'Reason / ticket ref — required for a cross-user SUPER_ADMIN operator review.',
  })
  @ZodResponse({ type: AiTranscriptResponseDto, status: 200, description: 'Transcript page' })
  getTranscript(
    @CurrentUser() principal: RequestPrincipal,
    @Param('id') id: string,
    @Query() query: AiTranscriptQueryDto,
    // The reason is a header (not a query param) so it never lands in access-log URLs; redacted in logs.
    @Headers(AI_OPERATOR_REASON_HEADER) reason?: string
  ): Promise<AiTranscriptResponse> {
    return this.operator.getTranscript(principal, id, query, reason)
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Post a human turn while holding control' })
  @ZodResponse({ type: AiMessageResponseDto, status: 201, description: 'Posted message' })
  postMessage(
    @CurrentUser() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: PostOperatorMessageDto
  ): Promise<AiMessageResponse> {
    return this.operator.postMessage(principal, id, dto)
  }
}
