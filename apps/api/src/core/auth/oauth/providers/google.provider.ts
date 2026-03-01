import type { Configuration } from 'openid-client'

import type { OAuthTokens, OAuthUserProfile } from '@amcore/shared'

import type { OAuthClientService } from '../oauth-client.service'

import type { OAuthProvider, OAuthProviderConfig } from './oauth-provider.interface'

/**
 * Google OAuth provider via OIDC discovery.
 * Uses openid-client (via OAuthClientService) for JWKS validation,
 * ID token verification, PKCE, and discovery document caching.
 */
export class GoogleProvider implements OAuthProvider {
  readonly name = 'google'

  private config: Configuration | null = null

  constructor(
    private readonly providerConfig: OAuthProviderConfig,
    private readonly oauthClient: OAuthClientService
  ) {}

  private async getConfig(): Promise<Configuration> {
    if (!this.config) {
      this.config = await this.oauthClient.discovery(
        new URL('https://accounts.google.com'),
        this.providerConfig.clientId,
        this.providerConfig.clientSecret
      )
    }
    return this.config
  }

  async getAuthorizationURL(state: string, codeVerifier: string): Promise<URL> {
    const config = await this.getConfig()
    const codeChallenge = await this.oauthClient.calculatePKCECodeChallenge(codeVerifier)

    return this.oauthClient.buildAuthorizationUrl(config, {
      redirect_uri: this.providerConfig.redirectUri,
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    const config = await this.getConfig()

    const callbackUrl = new URL(this.providerConfig.redirectUri)
    callbackUrl.searchParams.set('code', code)

    const tokens = await this.oauthClient.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: this.oauthClient.skipStateCheck,
    })

    return {
      accessToken: tokens.access_token ?? '',
      idToken: tokens.id_token,
      expiresIn: tokens.expires_in,
    }
  }

  async getUserProfile(tokens: OAuthTokens): Promise<OAuthUserProfile> {
    const config = await this.getConfig()

    const userInfo = await this.oauthClient.fetchUserInfo(
      config,
      tokens.accessToken,
      this.oauthClient.skipSubjectCheck
    )

    return {
      providerId: String(userInfo.sub),
      provider: 'google',
      email: userInfo.email ?? null,
      emailVerified: userInfo.email_verified ?? false,
      displayName: (userInfo.name as string) ?? null,
      avatarUrl: (userInfo.picture as string) ?? null,
    }
  }
}
