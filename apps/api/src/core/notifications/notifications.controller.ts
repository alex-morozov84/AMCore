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
  @ApiOperation({
    summary: 'Cursor-paginated in-app notification feed',
    description:
      "Lists the caller's non-archived notifications that were delivered in-app. A notification " +
      'appears here only if the in-app channel was selected when it was produced (mandatory, or ' +
      'optional with the master toggle and the category preference on); a notification delivered ' +
      'only externally, or produced while in-app was disabled, is never listed. Later preference ' +
      'changes do not add or remove existing items. Pages are filtered before the limit, so ' +
      '`hasMore`/`nextCursor` always describe feed items only.',
  })
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
  @ApiOperation({
    summary: 'Unread notification count',
    description:
      "Counts unread, non-archived notifications of the caller's in-app feed — the same set that " +
      '`GET /notifications` lists, so the count and the list always agree.',
  })
  @ZodResponse({ type: UnreadCountResponseDto, status: 200, description: 'Unread count' })
  async unreadCount(@CurrentUser('sub') userId: string): Promise<UnreadCountResponse> {
    return { unread: await this.feed.getUnreadCount(userId) }
  }

  @Post('read-all')
  @ApiOperation({
    summary: 'Mark all notifications read',
    description:
      "Marks every unread, non-archived item of the caller's in-app feed as read. Notifications " +
      "outside the feed (never delivered in-app, archived, or another user's) are not touched.",
  })
  @ZodResponse({
    type: MarkAllReadResponseDto,
    status: 200,
    description: 'Number of feed items marked read (0 when there was nothing to change)',
  })
  async markAllRead(@CurrentUser('sub') userId: string): Promise<MarkAllReadResponse> {
    return { updated: await this.feed.markAllRead(userId) }
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark one notification read',
    description:
      'Idempotent. A no-op (still `204`, no realtime hint) when the id is unknown, belongs to ' +
      'another user, is archived, was not delivered in-app, or is already read.',
  })
  @ApiNoContentResponse({ description: 'Marked read, or nothing to change (idempotent no-op)' })
  async markRead(@CurrentUser('sub') userId: string, @Param('id') id: string): Promise<void> {
    await this.feed.markRead(userId, id)
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Archive one notification',
    description:
      'Idempotent. A no-op (still `204`, no realtime hint) when the id is unknown, belongs to ' +
      'another user, was not delivered in-app, or is already archived.',
  })
  @ApiNoContentResponse({ description: 'Archived, or nothing to change (idempotent no-op)' })
  async archive(@CurrentUser('sub') userId: string, @Param('id') id: string): Promise<void> {
    await this.feed.archive(userId, id)
  }
}
