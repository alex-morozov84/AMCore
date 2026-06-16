import { createZodDto } from 'nestjs-zod'

import {
  markAllReadResponseSchema,
  notificationCapabilitiesResponseSchema,
  notificationFeedQuerySchema,
  notificationFeedResponseSchema,
  notificationPreferencesResponseSchema,
  unreadCountResponseSchema,
  updateNotificationPreferenceSchema,
  updateNotificationSettingsSchema,
} from '@amcore/shared'

/** Feed query (`?cursor=&limit=`) and response DTOs (ADR-050 typed surface). */
export class NotificationFeedQueryDto extends createZodDto(notificationFeedQuerySchema) {}
export class NotificationFeedResponseDto extends createZodDto(notificationFeedResponseSchema) {}
export class UnreadCountResponseDto extends createZodDto(unreadCountResponseSchema) {}
export class MarkAllReadResponseDto extends createZodDto(markAllReadResponseSchema) {}

/** Preferences/capabilities/settings DTOs. */
export class NotificationPreferencesResponseDto extends createZodDto(
  notificationPreferencesResponseSchema
) {}
export class UpdateNotificationPreferenceDto extends createZodDto(
  updateNotificationPreferenceSchema
) {}
export class UpdateNotificationSettingsDto extends createZodDto(updateNotificationSettingsSchema) {}
export class NotificationCapabilitiesResponseDto extends createZodDto(
  notificationCapabilitiesResponseSchema
) {}
