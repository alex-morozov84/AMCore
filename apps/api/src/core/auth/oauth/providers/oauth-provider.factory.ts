import { HttpStatus, Injectable } from '@nestjs/common'

import { AuthErrorCode, type FrontendDestination } from '@amcore/shared'

import { AppException } from '../../../../common/exceptions/index.js'
import { EnvService } from '../../../../env/env.service.js'
import { resolveFrontendPlacement } from '../../../frontend-context/frontend-placement.js'
import { OAuthClientService } from '../oauth-client.service.js'

import { AppleProvider } from './apple.provider.js'
import { GitHubProvider } from './github.provider.js'
import { GoogleProvider } from './google.provider.js'
import type { OAuthProvider } from './oauth-provider.interface.js'
import { TelegramProvider } from './telegram.provider.js'

@Injectable()
export class OAuthProviderFactory {
  private readonly providers = new Map<string, OAuthProvider>()

  constructor(
    private readonly env: EnvService,
    private readonly oauthClient: OAuthClientService
  ) {
    this.registerProviders()
  }

  get(name: string, frontend: FrontendDestination = 'site'): OAuthProvider {
    const key = frontend === 'site' ? name : `admin:${name}`
    if (frontend === 'admin' && !this.providers.has(key)) this.registerProviders(frontend)
    const provider = this.providers.get(key)
    if (!provider) {
      throw new AppException(
        `OAuth provider "${name}" is not configured`,
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.OAUTH_PROVIDER_NOT_CONFIGURED
      )
    }
    return provider
  }

  callbackUri(name: string, frontend: FrontendDestination = 'site'): string {
    if (frontend === 'admin')
      return `${resolveFrontendPlacement(this.env).admin}/api/product-admin/auth/oauth/${name}/callback`
    const keys = {
      google: 'GOOGLE_CALLBACK_URL',
      github: 'GITHUB_CALLBACK_URL',
      apple: 'APPLE_CALLBACK_URL',
      telegram: 'TELEGRAM_CALLBACK_URL',
    } as const
    const key = keys[name as keyof typeof keys]
    const uri = key ? this.env.get(key) : undefined
    if (!uri) throw new Error('OAuth provider callback is not configured')
    return uri
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys()).filter((name) => !name.startsWith('admin:'))
  }

  private registerProviders(frontend: FrontendDestination = 'site'): void {
    this.tryRegisterGoogle(frontend)
    this.tryRegisterGitHub(frontend)
    this.tryRegisterApple(frontend)
    this.tryRegisterTelegram(frontend)
  }

  private tryRegisterGoogle(frontend: FrontendDestination): void {
    const clientId = this.env.get('GOOGLE_CLIENT_ID')
    const clientSecret = this.env.get('GOOGLE_CLIENT_SECRET')
    const siteRedirect = this.env.get('GOOGLE_CALLBACK_URL')
    const redirectUri =
      !siteRedirect || frontend === 'site'
        ? siteRedirect
        : `${resolveFrontendPlacement(this.env).admin}/api/product-admin/auth/oauth/google/callback`
    if (!clientId || !clientSecret || !redirectUri) return

    this.providers.set(
      frontend === 'site' ? 'google' : 'admin:google',
      new GoogleProvider(
        {
          clientId,
          clientSecret,
          redirectUri,
        },
        this.oauthClient
      )
    )
  }

  private tryRegisterGitHub(frontend: FrontendDestination): void {
    const clientId = this.env.get('GITHUB_CLIENT_ID')
    const clientSecret = this.env.get('GITHUB_CLIENT_SECRET')
    const siteRedirect = this.env.get('GITHUB_CALLBACK_URL')
    const redirectUri =
      !siteRedirect || frontend === 'site'
        ? siteRedirect
        : `${resolveFrontendPlacement(this.env).admin}/api/product-admin/auth/oauth/github/callback`
    if (!clientId || !clientSecret || !redirectUri) return

    this.providers.set(
      frontend === 'site' ? 'github' : 'admin:github',
      new GitHubProvider({
        clientId,
        clientSecret,
        redirectUri,
      })
    )
  }

  private tryRegisterTelegram(frontend: FrontendDestination): void {
    const botToken = this.env.get('TELEGRAM_BOT_TOKEN')
    const siteRedirect = this.env.get('TELEGRAM_CALLBACK_URL')
    const redirectUri =
      !siteRedirect || frontend === 'site'
        ? siteRedirect
        : `${resolveFrontendPlacement(this.env).admin}/api/product-admin/auth/oauth/telegram/callback`
    if (!botToken || !redirectUri) return

    this.providers.set(
      frontend === 'site' ? 'telegram' : 'admin:telegram',
      new TelegramProvider(
        {
          botToken,
          redirectUri,
        },
        this.oauthClient
      )
    )
  }

  private tryRegisterApple(frontend: FrontendDestination): void {
    const clientId = this.env.get('APPLE_CLIENT_ID')
    const siteRedirect = this.env.get('APPLE_CALLBACK_URL')
    const redirectUri =
      !siteRedirect || frontend === 'site'
        ? siteRedirect
        : `${resolveFrontendPlacement(this.env).admin}/api/product-admin/auth/oauth/apple/callback`
    const teamId = this.env.get('APPLE_TEAM_ID')
    const keyId = this.env.get('APPLE_KEY_ID')
    const privateKey = this.env.get('APPLE_PRIVATE_KEY')
    if (!clientId || !redirectUri || !teamId || !keyId || !privateKey) return

    this.providers.set(
      frontend === 'site' ? 'apple' : 'admin:apple',
      new AppleProvider(
        {
          clientId,
          clientSecret: '', // Apple uses dynamic JWT — generated from P8 key
          redirectUri,
          teamId,
          keyId,
          privateKey,
        },
        this.oauthClient
      )
    )
  }
}
