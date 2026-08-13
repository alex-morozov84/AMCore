import type {
  MarkAllReadResponse,
  NotificationCapabilitiesResponse,
  NotificationFeedResponse,
  NotificationPreferencesResponse,
  UnreadCountResponse,
  UpdateNotificationPreferenceInput,
  UpdateNotificationSettingsInput,
} from '@amcore/shared'

import { apiClient } from '@/shared/api'

/**
 * All calls go through the generic same-origin BFF proxy (ADR-068) — no
 * dedicated Route Handler needed, since nothing here requires anything the
 * proxy can't already forward (bearer-only, no raw-cookie dependency like
 * `/auth/sessions`).
 */
export const notificationsApi = {
  getFeed: (cursor: string | undefined, limit: number): Promise<NotificationFeedResponse> => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    return apiClient.get<NotificationFeedResponse>(`/notifications?${params.toString()}`)
  },

  getUnreadCount: (): Promise<UnreadCountResponse> =>
    apiClient.get<UnreadCountResponse>('/notifications/unread-count'),

  markRead: (id: string): Promise<void> =>
    apiClient.post<void>(`/notifications/${encodeURIComponent(id)}/read`),

  markAllRead: (): Promise<MarkAllReadResponse> =>
    apiClient.post<MarkAllReadResponse>('/notifications/read-all'),

  archive: (id: string): Promise<void> =>
    apiClient.post<void>(`/notifications/${encodeURIComponent(id)}/archive`),

  // The active channel/category set is a backend registry, not a frontend
  // enum (ADR-052) — a UI reads this rather than hardcoding which channels
  // exist or which categories a user can override.
  getCapabilities: (): Promise<NotificationCapabilitiesResponse> =>
    apiClient.get<NotificationCapabilitiesResponse>('/notifications/capabilities'),

  getPreferences: (): Promise<NotificationPreferencesResponse> =>
    apiClient.get<NotificationPreferencesResponse>('/notifications/preferences'),

  updatePreference: (input: UpdateNotificationPreferenceInput): Promise<void> =>
    apiClient.put<void>('/notifications/preferences', input),

  updateSettings: (input: UpdateNotificationSettingsInput): Promise<void> =>
    apiClient.patch<void>('/notifications/settings', input),
}
