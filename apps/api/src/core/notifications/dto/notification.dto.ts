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

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

/** Feed query (`?cursor=&limit=`) and response DTOs (ADR-050 typed surface). */
export class NotificationFeedQueryDto extends createSchemaDto(notificationFeedQuerySchema) {}
export class NotificationFeedResponseDto extends createSchemaDto(notificationFeedResponseSchema) {}
export class UnreadCountResponseDto extends createSchemaDto(unreadCountResponseSchema) {}
export class MarkAllReadResponseDto extends createSchemaDto(markAllReadResponseSchema) {}

/** Preferences/capabilities/settings DTOs. */
export class NotificationPreferencesResponseDto extends createSchemaDto(
  notificationPreferencesResponseSchema
) {}
export class UpdateNotificationPreferenceDto extends createSchemaDto(
  updateNotificationPreferenceSchema
) {}
export class UpdateNotificationSettingsDto extends createSchemaDto(
  updateNotificationSettingsSchema
) {}
export class NotificationCapabilitiesResponseDto extends createSchemaDto(
  notificationCapabilitiesResponseSchema
) {}
