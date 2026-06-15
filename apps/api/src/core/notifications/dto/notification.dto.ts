import { createZodDto } from 'nestjs-zod'

import {
  markAllReadResponseSchema,
  notificationFeedQuerySchema,
  notificationFeedResponseSchema,
  unreadCountResponseSchema,
} from '@amcore/shared'

/** Feed query (`?cursor=&limit=`) and response DTOs (ADR-050 typed surface). */
export class NotificationFeedQueryDto extends createZodDto(notificationFeedQuerySchema) {}
export class NotificationFeedResponseDto extends createZodDto(notificationFeedResponseSchema) {}
export class UnreadCountResponseDto extends createZodDto(unreadCountResponseSchema) {}
export class MarkAllReadResponseDto extends createZodDto(markAllReadResponseSchema) {}
