import { Injectable } from '@nestjs/common'
import type {
  AuthorizationCodeGrantChecks,
  Configuration,
  TokenEndpointResponse,
  TokenEndpointResponseHelpers,
  UserInfoResponse,
} from 'openid-client'
import * as client from 'openid-client'

/**
 * Injectable wrapper around openid-client.
 * Isolates the ESM-only openid-client dependency behind a mockable interface,
 * following NestJS DI patterns for external SDK integration.
 * No unit tests needed — thin wrapper, covered by E2E tests.
 */
@Injectable()
export class OAuthClientService {
  async discovery(issuer: URL, clientId: string, clientSecret: string): Promise<Configuration> {
    return client.discovery(issuer, clientId, clientSecret)
  }

  async calculatePKCECodeChallenge(verifier: string): Promise<string> {
    return client.calculatePKCECodeChallenge(verifier)
  }

  buildAuthorizationUrl(config: Configuration, params: Record<string, string>): URL {
    return client.buildAuthorizationUrl(config, params)
  }

  async authorizationCodeGrant(
    config: Configuration,
    callbackUrl: URL,
    checks: AuthorizationCodeGrantChecks
  ): Promise<TokenEndpointResponse & TokenEndpointResponseHelpers> {
    return client.authorizationCodeGrant(config, callbackUrl, checks)
  }

  async fetchUserInfo(
    config: Configuration,
    accessToken: string,
    expectedSubject: string | typeof client.skipSubjectCheck
  ): Promise<UserInfoResponse> {
    return client.fetchUserInfo(config, accessToken, expectedSubject)
  }

  get skipStateCheck(): typeof client.skipStateCheck {
    return client.skipStateCheck
  }

  get skipSubjectCheck(): typeof client.skipSubjectCheck {
    return client.skipSubjectCheck
  }
}
