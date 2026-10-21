import { createHash } from 'node:crypto'

import { HttpStatus } from '@nestjs/common'

import type { OAuthTokens, OAuthUserProfile } from '@amcore/shared'
import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../../../common/exceptions/index.js'

import type { OAuthProvider, OAuthProviderConfig } from './oauth-provider.interface.js'

interface GitHubUser {
  id: number
  name: string | null
  login: string
  email: string | null
  avatar_url: string | null
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

/**
 * GitHub OAuth 2.0 provider.
 * GitHub supports S256 PKCE; profile data uses its REST endpoints, not OIDC.
 * Requires separate /user/emails call to get verified primary email.
 */
export class GitHubProvider implements OAuthProvider {
  readonly name = 'github'

  constructor(private readonly config: OAuthProviderConfig) {}

  getAuthorizationURL(state: string, codeVerifier: string): Promise<URL> {
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', this.config.redirectUri)
    url.searchParams.set('scope', 'read:user user:email')
    url.searchParams.set('state', state)
    url.searchParams.set(
      'code_challenge',
      createHash('sha256').update(codeVerifier).digest('base64url')
    )
    url.searchParams.set('code_challenge_method', 'S256')
    return Promise.resolve(url)
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
    options?: { legacyWithoutPkce?: boolean }
  ): Promise<OAuthTokens> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
        ...(options?.legacyWithoutPkce ? {} : { code_verifier: codeVerifier }),
      }),
    })

    const data = (await res.json()) as {
      access_token?: string
      error?: string
      error_description?: string
    }

    if (data.error ?? !data.access_token) {
      throw new AppException(
        data.error_description ?? 'GitHub token exchange failed',
        HttpStatus.BAD_GATEWAY,
        AuthErrorCode.OAUTH_PROVIDER_ERROR
      )
    }

    return { accessToken: data.access_token! }
  }

  async getUserProfile(tokens: OAuthTokens): Promise<OAuthUserProfile> {
    const headers = { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' }

    const [userRes, emailsRes] = await Promise.all([
      fetch('https://api.github.com/user', { headers }),
      fetch('https://api.github.com/user/emails', { headers }),
    ])

    if (!userRes.ok) {
      throw new AppException(
        'Failed to fetch GitHub user profile',
        HttpStatus.BAD_GATEWAY,
        AuthErrorCode.OAUTH_PROVIDER_ERROR
      )
    }

    const user = (await userRes.json()) as GitHubUser
    const emails = emailsRes.ok ? ((await emailsRes.json()) as GitHubEmail[]) : []

    const primary = emails.find((e) => e.primary && e.verified)

    return {
      providerId: String(user.id),
      provider: 'github',
      email: primary?.email ?? user.email ?? null,
      emailVerified: primary?.verified ?? false,
      displayName: user.name ?? user.login,
      avatarSourceUrl: user.avatar_url ?? null,
    }
  }
}
