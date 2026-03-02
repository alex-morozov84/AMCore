import { Injectable } from '@nestjs/common'
import { importPKCS8, SignJWT } from 'jose'
import type {
  AuthorizationCodeGrantChecks,
  ClientAuth,
  Configuration,
  TokenEndpointResponse,
  TokenEndpointResponseHelpers,
  UserInfoResponse,
} from 'openid-client'
import * as client from 'openid-client'

/** Apple client_secret JWT is valid for up to 6 months */
const APPLE_CLIENT_SECRET_TTL_SECONDS = 15_777_000

/**
 * Injectable wrapper around openid-client and jose.
 * Isolates ESM-only dependencies behind a mockable interface,
 * following NestJS DI patterns for external SDK integration.
 * No unit tests needed — thin wrapper, covered by E2E tests.
 */
@Injectable()
export class OAuthClientService {
  readonly skipStateCheck: typeof client.skipStateCheck = client.skipStateCheck
  readonly skipSubjectCheck: typeof client.skipSubjectCheck = client.skipSubjectCheck

  async discovery(
    issuer: URL,
    clientId: string,
    clientSecret: string,
    clientAuthentication?: ClientAuth
  ): Promise<Configuration> {
    return client.discovery(issuer, clientId, clientSecret, clientAuthentication)
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

  /**
   * Generate Apple's dynamic client_secret JWT.
   * Apple does not use a static secret — the secret is a short-lived JWT
   * signed with the P8 private key from Apple Developer Console.
   */
  async generateAppleClientSecret(
    teamId: string,
    clientId: string,
    keyId: string,
    privateKeyPem: string
  ): Promise<string> {
    const privateKey = await importPKCS8(privateKeyPem, 'ES256')

    return new SignJWT()
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt()
      .setExpirationTime(`${APPLE_CLIENT_SECRET_TTL_SECONDS}s`)
      .setAudience('https://appleid.apple.com')
      .setSubject(clientId)
      .sign(privateKey)
  }

  clientSecretPost(): ClientAuth {
    return client.ClientSecretPost()
  }
}
