import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import {
  AuthType,
  type TelegramConnectionResponse,
  type TelegramLinkResponse,
} from '@amcore/shared'

import { Auth } from '../../../auth/decorators/auth.decorator'
import { CurrentUser } from '../../../auth/decorators/current-user.decorator'

import { TelegramConnectionResponseDto, TelegramLinkResponseDto } from './telegram.dto'
import { TelegramLinkService } from './telegram-link.service'

/**
 * Bearer-authenticated Telegram linking surface (Arc D / D.6). The raw link token is returned only
 * inside the one-time `url`; the status endpoint never echoes it or any chat/user id. Unlink is a
 * 204 (the connection + its due deliveries are torn down server-side).
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@Controller('notifications/telegram')
export class TelegramController {
  constructor(private readonly linkService: TelegramLinkService) {}

  @Post('link')
  @ApiOperation({ summary: 'Issue a one-time Telegram deep-link' })
  @ZodResponse({ type: TelegramLinkResponseDto, status: 201, description: 'Deep-link issued' })
  issueLink(@CurrentUser('sub') userId: string): Promise<TelegramLinkResponse> {
    return this.linkService.issueLink(userId)
  }

  @Get('connection')
  @ApiOperation({ summary: 'Current Telegram connection status' })
  @ZodResponse({
    type: TelegramConnectionResponseDto,
    status: 200,
    description: 'Connection status',
  })
  getConnection(@CurrentUser('sub') userId: string): Promise<TelegramConnectionResponse> {
    return this.linkService.getConnection(userId)
  }

  @Delete('connection')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlink Telegram (cancels its pending deliveries)' })
  @ApiNoContentResponse({ description: 'Telegram unlinked' })
  async unlink(@CurrentUser('sub') userId: string): Promise<void> {
    await this.linkService.unlink(userId)
  }
}
