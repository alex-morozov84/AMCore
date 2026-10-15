/** Normalized user profile from any OAuth provider */
export interface OAuthUserProfile {
  providerId: string
  provider: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
  /** Provider-hosted picture URL; only downloaded once into our storage, never persisted or sent to a browser. */
  avatarSourceUrl: string | null
  phone?: string | null
}

/** Tokens received from OAuth provider */
export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresIn?: number
}
