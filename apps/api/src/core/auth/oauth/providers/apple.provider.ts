import type { Configuration } from 'openid-client'

import type { OAuthTokens, OAuthUserProfile } from '@amcore/shared'

import type { OAuthClientService } from '../oauth-client.service'

import type { OAuthProvider, OAuthProviderConfig } from './oauth-provider.interface'

export interface AppleProviderConfig extends OAuthProviderConfig {
  teamId: string
  keyId: string
  /** PEM string of the P8 private key from Apple Developer Console */
  privateKey: string
}

/**
 * Apple Sign In provider (OIDC).
 *
 * Key differences from other providers:
 * - client_secret is a short-lived JWT signed with P8 private key (not static)
 * - response_mode=form_post (Apple POSTs the callback, not GET)
 * - User name is sent only on the first authorization — store it immediately
 * - Uses openid-client discovery for JWKS + ID token validation
 */
export class AppleProvider implements OAuthProvider {
  readonly name = 'apple'

  private config: Configuration | null = null
  private clientSecret: string | null = null

  constructor(
    private readonly providerConfig: AppleProviderConfig,
    private readonly oauthClient: OAuthClientService
  ) {}

  private async getClientSecret(): Promise<string> {
    if (!this.clientSecret) {
      this.clientSecret = await this.oauthClient.generateAppleClientSecret(
        this.providerConfig.teamId,
        this.providerConfig.clientId,
        this.providerConfig.keyId,
        this.providerConfig.privateKey
      )
    }
    return this.clientSecret
  }

  private async getConfig(): Promise<Configuration> {
    if (!this.config) {
      const clientSecret = await this.getClientSecret()
      this.config = await this.oauthClient.discovery(
        new URL('https://appleid.apple.com'),
        this.providerConfig.clientId,
        clientSecret,
        this.oauthClient.clientSecretPost()
      )
    }
    return this.config
  }

  async getAuthorizationURL(state: string, codeVerifier: string): Promise<URL> {
    const config = await this.getConfig()
    const codeChallenge = await this.oauthClient.calculatePKCECodeChallenge(codeVerifier)

    return this.oauthClient.buildAuthorizationUrl(config, {
      redirect_uri: this.providerConfig.redirectUri,
      scope: 'openid name email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      response_mode: 'form_post',
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

    // Apple validates subject via ID token — use fetchUserInfo for OIDC compliance
    const userInfo = await this.oauthClient.fetchUserInfo(
      config,
      tokens.accessToken,
      this.oauthClient.skipSubjectCheck
    )

    return {
      providerId: String(userInfo.sub),
      provider: 'apple',
      email: (userInfo.email as string) ?? null,
      // Apple marks email as verified if it's a real Apple ID email
      emailVerified: (userInfo.email_verified as boolean) ?? false,
      // Name is only available on first login via form_post body (not in userinfo)
      displayName: null,
      avatarUrl: null,
    }
  }
}
