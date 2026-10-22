import type { Configuration } from 'openid-client'

import type { OAuthTokens, OAuthUserProfile } from '@amcore/shared'

import type { OAuthClientService } from '../oauth-client.service.js'

import { appleVerifiedIdentity } from './apple-identity.js'
import type { OAuthProvider, OAuthProviderConfig } from './oauth-provider.interface.js'

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
      this.oauthClient.enableNonRepudiationChecks(this.config)
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
      idTokenExpected: true,
    })

    return {
      accessToken: tokens.access_token ?? '',
      idToken: tokens.id_token,
      expiresIn: tokens.expires_in,
      verifiedIdentity: appleVerifiedIdentity(tokens.claims()),
    }
  }

  getUserProfile(tokens: OAuthTokens): Promise<OAuthUserProfile> {
    if (!tokens.verifiedIdentity) throw new Error('Verified Apple identity required')
    return Promise.resolve({
      ...tokens.verifiedIdentity,
      provider: 'apple',
      // Name is display data from the first form_post, never identity proof.
      displayName: null,
      avatarSourceUrl: null,
    })
  }
}
