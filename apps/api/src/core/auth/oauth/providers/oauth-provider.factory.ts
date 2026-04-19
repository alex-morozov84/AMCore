import { HttpStatus, Injectable } from '@nestjs/common'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../../../common/exceptions'
import { EnvService } from '../../../../env/env.service'
import { OAuthClientService } from '../oauth-client.service'

import { AppleProvider } from './apple.provider'
import { GitHubProvider } from './github.provider'
import { GoogleProvider } from './google.provider'
import type { OAuthProvider } from './oauth-provider.interface'
import { TelegramProvider } from './telegram.provider'

@Injectable()
export class OAuthProviderFactory {
  private readonly providers = new Map<string, OAuthProvider>()

  constructor(
    private readonly env: EnvService,
    private readonly oauthClient: OAuthClientService
  ) {
    this.registerProviders()
  }

  get(name: string): OAuthProvider {
    const provider = this.providers.get(name)
    if (!provider) {
      throw new AppException(
        `OAuth provider "${name}" is not configured`,
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.OAUTH_PROVIDER_NOT_CONFIGURED
      )
    }
    return provider
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys())
  }

  private registerProviders(): void {
    this.tryRegisterGoogle()
    this.tryRegisterGitHub()
    this.tryRegisterApple()
    this.tryRegisterTelegram()
  }

  private tryRegisterGoogle(): void {
    const clientId = this.env.get('GOOGLE_CLIENT_ID')
    const clientSecret = this.env.get('GOOGLE_CLIENT_SECRET')
    const redirectUri = this.env.get('GOOGLE_CALLBACK_URL')
    if (!clientId || !clientSecret || !redirectUri) return

    this.providers.set(
      'google',
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

  private tryRegisterGitHub(): void {
    const clientId = this.env.get('GITHUB_CLIENT_ID')
    const clientSecret = this.env.get('GITHUB_CLIENT_SECRET')
    const redirectUri = this.env.get('GITHUB_CALLBACK_URL')
    if (!clientId || !clientSecret || !redirectUri) return

    this.providers.set(
      'github',
      new GitHubProvider({
        clientId,
        clientSecret,
        redirectUri,
      })
    )
  }

  private tryRegisterTelegram(): void {
    const botToken = this.env.get('TELEGRAM_BOT_TOKEN')
    const redirectUri = this.env.get('TELEGRAM_CALLBACK_URL')
    if (!botToken || !redirectUri) return

    this.providers.set(
      'telegram',
      new TelegramProvider(
        {
          botToken,
          redirectUri,
        },
        this.oauthClient
      )
    )
  }

  private tryRegisterApple(): void {
    const clientId = this.env.get('APPLE_CLIENT_ID')
    const redirectUri = this.env.get('APPLE_CALLBACK_URL')
    const teamId = this.env.get('APPLE_TEAM_ID')
    const keyId = this.env.get('APPLE_KEY_ID')
    const privateKey = this.env.get('APPLE_PRIVATE_KEY')
    if (!clientId || !redirectUri || !teamId || !keyId || !privateKey) return

    this.providers.set(
      'apple',
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
