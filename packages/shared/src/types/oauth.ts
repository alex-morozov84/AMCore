/** Normalized user profile from any OAuth provider */
export interface OAuthUserProfile {
  providerId: string
  provider: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
  avatarUrl: string | null
}

/** Tokens received from OAuth provider */
export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresIn?: number
}
