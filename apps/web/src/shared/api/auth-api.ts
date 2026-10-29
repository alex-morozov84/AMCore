import type {
  AvatarResponse,
  ForgotPasswordInput,
  LoginInput,
  MfaBrowserSignInPending,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  SessionsListResponse,
  SupportedLocale,
  UpdateProfileInput,
  UserResponse,
  VerifyEmailInput,
} from '@amcore/shared'

import { apiClient } from './http-client'

interface UserEnvelope {
  user: UserResponse
  contextSession?: string
}

interface MeResponse {
  /** `null` when the access token is valid but its user no longer exists. */
  user: UserResponse | null
  contextSession?: string
}

interface MessageResponse {
  message: string
}

/** The application composition selects a literal endpoint family, never user input. */
export type AuthActionBase = '/auth' | '/product-admin/auth'
export type BrowserLoginResponse = UserEnvelope | MfaBrowserSignInPending

/** A live attempt requires an explicit decision before new credentials are dispatched. */
export class PendingBrowserFlowError extends Error {
  constructor(public readonly flowBinding: string) {
    super('PENDING_BROWSER_FLOW')
  }
}

async function passwordSignIn(
  base: AuthActionBase,
  data: LoginInput,
  entry?: {
    entryId: string
    returnEntryId?: string
    entryKind?: 'console'
    locale: SupportedLocale
  }
): Promise<BrowserLoginResponse> {
  const bootstrap = await apiClient.post<
    { attemptId: string } | { kind: 'resume_required'; flowBinding: string }
  >(`${base}/browser-context`, entry ?? {})
  if ('kind' in bootstrap) throw new PendingBrowserFlowError(bootstrap.flowBinding)
  return apiClient.post<BrowserLoginResponse>(`${base}/login`, data, {
    headers: { 'x-amcore-login-attempt': bootstrap.attemptId },
  })
}

export function authActions(
  base: AuthActionBase,
  entry?: {
    entryId: string
    returnEntryId?: string
    entryKind?: 'console'
    locale: SupportedLocale
  }
) {
  return {
    login: (data: LoginInput) => passwordSignIn(base, data, entry),
    logout: (contextSession?: string) =>
      apiClient.post<MessageResponse>(`${base}/logout`, undefined, {
        headers: contextSession ? { 'x-amcore-context-session': contextSession } : {},
      }),
    forgotPassword: (data: ForgotPasswordInput) =>
      apiClient.post<MessageResponse>(`${base}/forgot-password`, data),
    resetPassword: (data: ResetPasswordInput) =>
      apiClient.post<void>(`${base}/reset-password`, data),
    verifyEmail: (data: VerifyEmailInput) => apiClient.post<void>(`${base}/verify-email`, data),
    resendVerification: (data: ResendVerificationInput) =>
      apiClient.post<MessageResponse>(`${base}/resend-verification`, data),
  }
}

/**
 * All calls go through this app's own same-origin `/api/*` Route Handlers
 * (ADR-068), never `apps/api` directly — no access token ever reaches this
 * client. `login`/`register` return `{ user }` only, by design: the BFF
 * mints the session server-side and sets `amcore_session` itself.
 */
export const authApi = {
  register: async (data: RegisterInput): Promise<UserEnvelope> => {
    const bootstrap = await apiClient.post<{ attemptId: string }>('/auth/browser-context', {})
    return apiClient.post<UserEnvelope>('/auth/register', data, {
      headers: { 'x-amcore-login-attempt': bootstrap.attemptId },
    })
  },

  login: (data: LoginInput): Promise<BrowserLoginResponse> => passwordSignIn('/auth', data),

  logout: (contextSession?: string): Promise<MessageResponse> =>
    apiClient.post<MessageResponse>('/auth/logout', undefined, {
      headers: contextSession ? { 'x-amcore-context-session': contextSession } : {},
    }),

  // Always the same enumeration-safe message regardless of whether the
  // account exists — never rendered as-is (it's backend English prose);
  // the frontend shows its own translated confirmation on success instead.
  forgotPassword: (data: ForgotPasswordInput): Promise<MessageResponse> =>
    apiClient.post<MessageResponse>('/auth/forgot-password', data),

  resetPassword: (data: ResetPasswordInput): Promise<void> =>
    apiClient.post<void>('/auth/reset-password', data),

  verifyEmail: (data: VerifyEmailInput): Promise<void> =>
    apiClient.post<void>('/auth/verify-email', data),

  resendVerification: (data: ResendVerificationInput): Promise<MessageResponse> =>
    apiClient.post<MessageResponse>('/auth/resend-verification', data),

  getMe: async (): Promise<MeResponse> => {
    let contextSession: string | undefined
    const result = await apiClient.get<MeResponse>('/auth/me', {
      onResponseHeaders: (headers) => {
        contextSession = headers.get('x-amcore-context-session') ?? undefined
      },
    })
    return { ...result, ...(contextSession ? { contextSession } : {}) }
  },

  updateMe: (data: UpdateProfileInput): Promise<UserEnvelope> =>
    apiClient.patch<UserEnvelope>('/auth/me', data),

  // `/auth/sessions*` are dedicated Route Handlers, not the generic proxy —
  // the backend identifies the "current" session from the raw
  // `refresh_token` cookie, which the generic proxy never forwards. See
  // `shared/api/bff/sessions-handler.ts`. `locale` is sent explicitly as
  // `Accept-Language` — the BFF route isn't under `[locale]`, so it cannot
  // infer the active UI locale on its own, and the browser's own
  // `Accept-Language` need not match the manually selected UI language.
  getSessions: (
    page: number,
    limit: number,
    locale: SupportedLocale
  ): Promise<SessionsListResponse> =>
    apiClient.get<SessionsListResponse>(`/auth/sessions?page=${page}&limit=${limit}`, {
      headers: { 'Accept-Language': locale },
    }),

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
