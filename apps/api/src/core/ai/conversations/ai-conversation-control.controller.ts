import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import { type AiConversationResponse, AuthType, type RequestPrincipal } from '@amcore/shared'

import { Auth } from '../../auth/decorators/auth.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import {
  AiConversationResponseDto,
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
}
