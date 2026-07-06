import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import { type AiConversationResponse, AuthType } from '@amcore/shared'

import { Auth } from '../../auth/decorators/auth.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import { AiConversationResponseDto, CreateAiConversationDto } from '../dto/ai.dto'

import { AiConversationService } from './ai-conversation.service'

/**
 * AI conversation surface (Track C — ADR-054, Arc C), bearer-authenticated and owner-scoped. Web
 * role only — no provider I/O. There is no list/delete yet (later arcs).
 */
@ApiTags('AI')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@Controller('ai/conversations')
export class AiConversationsController {
  constructor(private readonly conversations: AiConversationService) {}

  @Post()
  @ApiOperation({ summary: 'Create an AI conversation' })
  @ZodResponse({
    type: AiConversationResponseDto,
    status: 201,
    description: 'Created conversation',
  })
  create(
    @CurrentUser('sub') userId: string,
    @Body() body: CreateAiConversationDto
  ): Promise<AiConversationResponse> {
    return this.conversations.create(userId, body)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one owned AI conversation' })
  @ZodResponse({ type: AiConversationResponseDto, status: 200, description: 'Conversation' })
  get(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string
  ): Promise<AiConversationResponse> {
    return this.conversations.getOwned(userId, id)
  }
}
