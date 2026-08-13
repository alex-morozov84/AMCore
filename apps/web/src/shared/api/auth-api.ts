import type {
  AvatarResponse,
  LoginInput,
  RegisterInput,
  SessionsListResponse,
  UpdateProfileInput,
  UserResponse,
} from '@amcore/shared'

import { apiClient } from './http-client'

interface UserEnvelope {
  user: UserResponse
}

interface MeResponse {
  /** `null` when the access token is valid but its user no longer exists. */
  user: UserResponse | null
}

interface MessageResponse {
  message: string
}

/**
 * All calls go through this app's own same-origin `/api/*` Route Handlers
 * (ADR-068), never `apps/api` directly — no access token ever reaches this
 * client. `login`/`register` return `{ user }` only, by design: the BFF
 * mints the session server-side and sets `amcore_session` itself.
 */
export const authApi = {
  register: (data: RegisterInput): Promise<UserEnvelope> =>
    apiClient.post<UserEnvelope>('/auth/register', data),

  login: (data: LoginInput): Promise<UserEnvelope> =>
    apiClient.post<UserEnvelope>('/auth/login', data),

  logout: (): Promise<MessageResponse> => apiClient.post<MessageResponse>('/auth/logout'),

  getMe: (): Promise<MeResponse> => apiClient.get<MeResponse>('/auth/me'),

  updateMe: (data: UpdateProfileInput): Promise<UserEnvelope> =>
    apiClient.patch<UserEnvelope>('/auth/me', data),

  // `/auth/sessions*` are dedicated Route Handlers, not the generic proxy —
  // the backend identifies the "current" session from the raw
  // `refresh_token` cookie, which the generic proxy never forwards. See
  // `shared/api/bff/sessions-handler.ts`.
  getSessions: (page: number, limit: number): Promise<SessionsListResponse> =>
    apiClient.get<SessionsListResponse>(`/auth/sessions?page=${page}&limit=${limit}`),

  revokeSession: (sessionId: string): Promise<void> =>
    apiClient.delete<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`),

  revokeOtherSessions: (): Promise<void> => apiClient.delete<void>('/auth/sessions'),

  // `/auth/me/avatar` needs no dedicated Route Handler — the generic proxy
  // already streams request bodies unmodified, which is exactly what a
  // multipart upload needs.
  uploadAvatar: (file: File): Promise<AvatarResponse> => {
    const form = new FormData()
    form.set('file', file)
    return apiClient.postForm<AvatarResponse>('/auth/me/avatar', form)
  },

  deleteAvatar: (): Promise<void> => apiClient.delete<void>('/auth/me/avatar'),
}
