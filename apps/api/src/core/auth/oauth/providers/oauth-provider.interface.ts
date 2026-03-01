import type { OAuthTokens, OAuthUserProfile } from '@amcore/shared'

export interface OAuthProviderConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface OAuthProvider {
  readonly name: string

  /** Build authorization URL (state + PKCE handled by OAuthService) */
  getAuthorizationURL(state: string, codeVerifier: string): Promise<URL>

  /** Exchange authorization code for tokens */
  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens>

  /** Fetch normalized user profile */
  getUserProfile(tokens: OAuthTokens): Promise<OAuthUserProfile>
}
