import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'

import {
  AuthType,
  type MarkAllReadResponse,
  type NotificationFeedResponse,
  type UnreadCountResponse,
} from '@amcore/shared'

import { BadRequestException } from '../../common/exceptions'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import {
  MarkAllReadResponseDto,
  NotificationFeedQueryDto,
  NotificationFeedResponseDto,
  UnreadCountResponseDto,
} from './dto/notification.dto'
import { NotificationFeedService } from './notification-feed.service'
import { InvalidFeedCursorError } from './notification-feed-cursor'

/**
 * In-app notification feed (Arc A.6), bearer-authenticated and scoped to the caller.
 * There is no create endpoint — notifications are produced internally (ADR-052).
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly feed: NotificationFeedService) {}

  @Get()
  @ApiOperation({ summary: 'Cursor-paginated in-app notification feed' })
  @ZodResponse({
    type: NotificationFeedResponseDto,
    status: 200,
    description: 'Notification feed page',
  })
  async getFeed(
    @CurrentUser('sub') userId: string,
    @Query() query: NotificationFeedQueryDto
  ): Promise<NotificationFeedResponse> {
    try {
      return await this.feed.getFeed(userId, query)
    } catch (error) {
      if (error instanceof InvalidFeedCursorError) throw new BadRequestException(error.message)
      throw error
    }
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count' })
  @ZodResponse({ type: UnreadCountResponseDto, status: 200, description: 'Unread count' })
  async unreadCount(@CurrentUser('sub') userId: string): Promise<UnreadCountResponse> {
    return { unread: await this.feed.getUnreadCount(userId) }
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications read' })
  @ZodResponse({ type: MarkAllReadResponseDto, status: 200, description: 'Number marked read' })
  async markAllRead(@CurrentUser('sub') userId: string): Promise<MarkAllReadResponse> {
    return { updated: await this.feed.markAllRead(userId) }
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one notification read' })
  @ApiNoContentResponse({ description: 'Marked read (idempotent)' })
  async markRead(@CurrentUser('sub') userId: string, @Param('id') id: string): Promise<void> {
    await this.feed.markRead(userId, id)
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive one notification' })
  @ApiNoContentResponse({ description: 'Archived (idempotent)' })
  async archive(@CurrentUser('sub') userId: string, @Param('id') id: string): Promise<void> {
    await this.feed.archive(userId, id)
  }
}
