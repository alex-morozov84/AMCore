import type {
  AuthResponse,
  LoginInput,
  RegisterInput,
  SessionsListResponse,
  UserResponse,
} from '@amcore/shared'

import { apiClient } from './client'

interface MeResponse {
  user: UserResponse
}

interface MessageResponse {
  message: string
}

export const authApi = {
  register: async (data: RegisterInput): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/register', data)
    return response.data
  },

  login: async (data: LoginInput): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/login', data)
    return response.data
  },

  logout: async (): Promise<MessageResponse> => {
    const response = await apiClient.post<MessageResponse>('/auth/logout')
    return response.data
  },

  getMe: async (): Promise<MeResponse> => {
    const response = await apiClient.get<MeResponse>('/auth/me')
    return response.data
  },

  // OB-05: `/auth/sessions` returns the canonical paginated envelope
  // `{ data, total, page, limit }` per ADR-036. Read `body.data[i]`,
  // not the legacy `body.sessions[i]`.
  getSessions: async (): Promise<SessionsListResponse> => {
    const response = await apiClient.get<SessionsListResponse>('/auth/sessions')
    return response.data
  },

  revokeSession: async (sessionId: string): Promise<MessageResponse> => {
    const response = await apiClient.delete<MessageResponse>(`/auth/sessions/${sessionId}`)
    return response.data
  },

  revokeOtherSessions: async (): Promise<MessageResponse> => {
    const response = await apiClient.delete<MessageResponse>('/auth/sessions')
    return response.data
  },
}
