jest.mock('../oauth-client.service', () => ({
  OAuthClientService: jest.fn(),
}))

jest.mock('./google.provider', () => ({
  GoogleProvider: jest.fn().mockImplementation(() => ({ name: 'google' })),
}))

jest.mock('./github.provider', () => ({
  GitHubProvider: jest.fn().mockImplementation(() => ({ name: 'github' })),
}))

jest.mock('./apple.provider', () => ({
  AppleProvider: jest.fn().mockImplementation(() => ({ name: 'apple' })),
}))

jest.mock('./telegram.provider', () => ({
  TelegramProvider: jest.fn().mockImplementation(() => ({ name: 'telegram' })),
}))

import { OAuthProviderFactory } from './oauth-provider.factory'

import { EnvService } from '@/env/env.service'

describe('OAuthProviderFactory', () => {
  const createFactory = (overrides: Record<string, string | undefined> = {}) => {
    const env = {
      get: jest.fn((key: string) => overrides[key]),
    } as unknown as jest.Mocked<EnvService>

    const oauthClient = {} as any

    return new OAuthProviderFactory(env, oauthClient)
  }

  it('does not register partially configured providers', () => {
    const factory = createFactory({
      GOOGLE_CLIENT_ID: 'google-client-id',
      GITHUB_CLIENT_ID: 'github-client-id',
      TELEGRAM_BOT_TOKEN: 'telegram-bot-token',
    })

    expect(factory.getAvailableProviders()).toEqual([])
  })

  it('registers a provider only when its config group is complete', () => {
    const factory = createFactory({
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GOOGLE_CALLBACK_URL: 'http://localhost:3002/api/v1/auth/google/callback',
    })

    expect(factory.getAvailableProviders()).toEqual(['google'])
  })
})
