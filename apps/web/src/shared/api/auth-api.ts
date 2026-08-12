import type { LoginInput, RegisterInput, UpdateProfileInput, UserResponse } from '@amcore/shared'

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
}
