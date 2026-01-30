import type {
  AuthResponse,
  LoginInput,
  RegisterInput,
  Session,
  UserResponse,
} from '@amcore/shared';

import { apiClient } from './client';

interface MeResponse {
  user: UserResponse;
}

interface SessionsResponse {
  sessions: Session[];
}

interface MessageResponse {
  message: string;
}

export const authApi = {
  register: async (data: RegisterInput): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/register', data);
    return response.data;
  },

  login: async (data: LoginInput): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/login', data);
    return response.data;
  },

  logout: async (): Promise<MessageResponse> => {
    const response = await apiClient.post<MessageResponse>('/auth/logout');
    return response.data;
  },

  getMe: async (): Promise<MeResponse> => {
    const response = await apiClient.get<MeResponse>('/auth/me');
    return response.data;
  },

  getSessions: async (): Promise<SessionsResponse> => {
    const response = await apiClient.get<SessionsResponse>('/auth/sessions');
    return response.data;
  },

  revokeSession: async (sessionId: string): Promise<MessageResponse> => {
    const response = await apiClient.delete<MessageResponse>(`/auth/sessions/${sessionId}`);
    return response.data;
  },

  revokeOtherSessions: async (): Promise<MessageResponse> => {
    const response = await apiClient.delete<MessageResponse>('/auth/sessions');
    return response.data;
  },
};
