import type { Configuration } from 'openid-client'

import type { OAuthTokens, OAuthUserProfile } from '@amcore/shared'

import type { OAuthClientService } from '../oauth-client.service'

import type { OAuthProvider } from './oauth-provider.interface'

export interface TelegramProviderConfig {
  botToken: string
  redirectUri: string
}

/**
 * Telegram OAuth provider via OIDC discovery.
 * Discovery: https://oauth.telegram.org/.well-known/openid-configuration
 *
 * Telegram does NOT provide email — only phone_number from ID token.
 * This provider is link-only: used to link Telegram account to existing user.
 */
export class TelegramProvider implements OAuthProvider {
  readonly name = 'telegram'

  private config: Configuration | null = null

  constructor(
    private readonly providerConfig: TelegramProviderConfig,
    private readonly oauthClient: OAuthClientService
  ) {}

  private async getConfig(): Promise<Configuration> {
    if (!this.config) {
      this.config = await this.oauthClient.discovery(
        new URL('https://oauth.telegram.org'),
        this.providerConfig.botToken,
        '' // no client secret for Telegram
      )
    }
    return this.config
  }

  async getAuthorizationURL(state: string, codeVerifier: string): Promise<URL> {
    const config = await this.getConfig()
    const codeChallenge = await this.oauthClient.calculatePKCECodeChallenge(codeVerifier)

    return this.oauthClient.buildAuthorizationUrl(config, {
      redirect_uri: this.providerConfig.redirectUri,
      scope: 'openid phone',
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
      provider: 'telegram',
      email: null,
      emailVerified: false,
      displayName: (userInfo.name as string) ?? null,
      avatarUrl: null,
      phone: (userInfo.phone_number as string) ?? null,
    }
  }
}
