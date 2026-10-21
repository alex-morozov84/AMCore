import { HttpStatus, Injectable } from '@nestjs/common'
import { randomBytes, timingSafeEqual } from 'crypto'
import { PinoLogger } from 'nestjs-pino'

import type { ProductAdminReturn } from '@amcore/shared'
import type {
  InvitationOAuthCorrelation,
  OAuthUserProfile,
  SupportedLocale,
  UserResponse,
} from '@amcore/shared'
import { AuthErrorCode, parseSupportedLocale } from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import { EnvService } from '../../../env/env.service.js'
import type { OAuthProvider, Prisma, User } from '../../../generated/prisma/client.js'
import { StorageService } from '../../../infrastructure/storage/index.js'
import { PrismaService } from '../../../prisma/index.js'
import type { BrowserFrontendContext } from '../../frontend-context/frontend-placement.js'
import { assertTokenFrontend } from '../../frontend-context/frontend-token.js'
import {
  type InvitationHandoffProof,
  lockInvitationAuthAttempt,
} from '../../invitations/invitation-auth-handoff.js'
import { InvitationContinuationService } from '../../invitations/invitation-continuation.service.js'
import {
  invalidInvitation,
  invitationClock,
  lockInvitationSignupEmail,
  lockInvitationUser,
} from '../../invitations/invitation-locks.js'
import { avatarUrlOf } from '../avatar-url.js'
import { EmailIdentityService } from '../email-identity.service.js'
import { SessionService } from '../session.service.js'
import type { AccessTokenPayload } from '../token.service.js'
import { UserCacheService } from '../user-cache.service.js'

import { OAuthAvatarRehostService } from './oauth-avatar-rehost.service.js'
import { generateOAuthStateNonce, hashOAuthStateNonce } from './oauth-nonce.js'
import { type OAuthInvitationState, OAuthStateService } from './oauth-state.service.js'
import { OAuthProviderFactory } from './providers/oauth-provider.factory.js'

interface LoginCallbackResult {
  mode: 'login'
  returnTo?: ProductAdminReturn
  invitation?: InvitationOAuthCorrelation
  user: UserResponse
  refreshToken: string
  sessionId: string
  accessClaims: AccessTokenPayload
}

interface LinkCallbackResult {
  mode: 'link'
  user: UserResponse
}

type CallbackResult = LoginCallbackResult | LinkCallbackResult

interface RequestInfo {
  userAgent?: string
  ipAddress?: string
}

@Injectable()
export class OAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly userCacheService: UserCacheService,
    private readonly providerFactory: OAuthProviderFactory,
    private readonly stateService: OAuthStateService,
    private readonly emailIdentity: EmailIdentityService,
    private readonly logger: PinoLogger,
    private readonly env: EnvService,
    private readonly invitationAuthority: InvitationContinuationService,
    private readonly storage: StorageService,
    private readonly avatarRehost: OAuthAvatarRehostService
  ) {
    this.logger.setContext(OAuthService.name)
  }

  async getAuthorizationURL(
    providerName: string,
    locale?: SupportedLocale,
    invited?: { credential: string; attemptId: string; handoff: InvitationHandoffProof },
    frontend?: BrowserFrontendContext,
    returnTo?: ProductAdminReturn
  ): Promise<{ url: string; browserNonce: string }> {
    const provider = this.providerFactory.get(providerName, frontend?.frontend ?? 'site')
    const state = randomBytes(32).toString('base64url')
    const codeVerifier = randomBytes(32).toString('base64url')
    const browserNonce = generateOAuthStateNonce()

    let invitation: OAuthInvitationState | undefined
    if (invited) {
      if (
        invited.attemptId !== invited.handoff.attemptId ||
        !['google', 'github', 'apple'].includes(providerName)
      )
        throw invalidInvitation()
      invitation = await this.prisma.$transaction(
        async (tx) => {
          const { invite, expiresAt } = await this.invitationAuthority.lockValid(tx, {
            continuation: invited.credential,
          })
          assertTokenFrontend(invite, frontend)
          return {
            correlation: {
              attemptId: invited.attemptId,
              provider: providerName as 'google' | 'github' | 'apple',
              expectedInviteId: invite.id,
              expectedGeneration: invite.generation,
            },
            cleanupKeyHash: invited.handoff.cleanupKeyHash,
            expiresAt: expiresAt.toISOString(),
          }
        },
        { maxWait: 2000, timeout: 4000 }
      )
    }
    await this.stateService.store(state, {
      provider: providerName,
      codeVerifier,
      mode: 'login',
      pkceMethod: 'S256',
      ...(frontend
        ? {
            ...frontend,
            callbackUri: this.providerFactory.callbackUri(providerName, frontend.frontend),
            returnTo,
          }
        : {}),
      ...(invitation ? { invitation } : {}),
      browserNonceHash: hashOAuthStateNonce(browserNonce),
      ...(locale ? { locale } : {}),
    })

    const url = await provider.getAuthorizationURL(state, codeVerifier)
    return { url: url.toString(), browserNonce }
  }

  async getLinkAuthorizationURL(
    providerName: string,
    userId: string,
    frontend?: BrowserFrontendContext
  ): Promise<{ url: string; browserNonce: string }> {
    const provider = this.providerFactory.get(providerName, frontend?.frontend ?? 'site')
    const state = randomBytes(32).toString('base64url')
    const codeVerifier = randomBytes(32).toString('base64url')
    const browserNonce = generateOAuthStateNonce()

    await this.stateService.store(state, {
      provider: providerName,
      codeVerifier,
      mode: 'link',
      pkceMethod: 'S256',
      ...(frontend
        ? {
            ...frontend,
            callbackUri: this.providerFactory.callbackUri(providerName, frontend.frontend),
          }
        : {}),
      userId,
      browserNonceHash: hashOAuthStateNonce(browserNonce),
    })

    const url = await provider.getAuthorizationURL(state, codeVerifier)
    return { url: url.toString(), browserNonce }
  }

  async handleCallback(
    providerName: string,
    code: string,
    state: string,
    browserNonce: string | undefined,
    requestInfo: RequestInfo,
    firstLoginName?: string | null,
    frontend?: BrowserFrontendContext
  ): Promise<CallbackResult> {
    const stateData = await this.stateService.consume(state)
    if (!stateData || stateData.provider !== providerName) {
      throw new AppException(
        'Invalid OAuth state',
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.OAUTH_STATE_INVALID
      )
    }

    // Browser binding (login CSRF / session-swap defense): the callback must run
    // in the same browser that started the flow. Uniform OAUTH_STATE_INVALID so a
    // missing/mismatched binding is indistinguishable from a bad state.
    this.assertBrowserBinding(browserNonce, stateData.browserNonceHash)

    const expectedFrontend = stateData.frontend ?? 'site'
    if (
      expectedFrontend !== (frontend?.frontend ?? 'site') ||
      (stateData.frontend &&
        (!frontend ||
          stateData.placementFingerprint !== frontend.placementFingerprint ||
          stateData.callbackUri !==
            this.providerFactory.callbackUri(providerName, expectedFrontend)))
    )
      throw new AppException(
        'Invalid OAuth state',
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.OAUTH_STATE_INVALID
      )
    const provider = this.providerFactory.get(providerName, expectedFrontend)
    const tokens =
      providerName === 'github' && stateData.pkceMethod !== 'S256'
        ? await provider.exchangeCode(code, stateData.codeVerifier, { legacyWithoutPkce: true })
        : await provider.exchangeCode(code, stateData.codeVerifier)
    const profile = await provider.getUserProfile(tokens)

    // Apple sends the display name only in the first-login `form_post` `user`
    // field, never in the ID token/userinfo. Fold it in (without clobbering a
    // name the provider did supply) so `createOAuthUser` can persist it.
    if (firstLoginName && !profile.displayName) {
      profile.displayName = firstLoginName
    }

    if (stateData.mode === 'link') {
      const user = await this.attachProviderToUser(stateData.userId!, profile, providerName)
      this.logger.info({ userId: stateData.userId, provider: providerName }, 'oauth link')
      return { mode: 'link', user: this.mapUserToResponse(user) }
    }

    if (!profile.email) {
      throw new AppException(
        'Email is required',
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.OAUTH_EMAIL_REQUIRED
      )
    }

    if (stateData.invitation && !profile.emailVerified) throw invalidInvitation()

    const { user, accountCreated, session, refreshToken } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2000ms'`
        const emailCanonical = this.emailIdentity.canonicalize(profile.email!)
        if (stateData.invitation) {
          await lockInvitationAuthAttempt(tx, {
            attemptId: stateData.invitation.correlation.attemptId,
            cleanupKeyHash: stateData.invitation.cleanupKeyHash,
          })
          await lockInvitationSignupEmail(tx, emailCanonical)
        }
        const provider = providerName.toUpperCase() as OAuthProvider
        const account = await tx.oAuthAccount.findUnique({
          where: {
            provider_providerAccountId: { provider, providerAccountId: profile.providerId },
          },
          select: { userId: true },
        })
        const existingUser = account
          ? { id: account.userId }
          : await tx.user.findUnique({ where: { emailCanonical }, select: { id: true } })
        if (existingUser) await lockInvitationUser(tx, existingUser.id, true)
        if (stateData.invitation) {
          const invite = await this.invitationAuthority.lockOAuthIntent(
            tx,
            stateData.invitation.correlation,
            stateData.invitation.expiresAt
          )
          if (invite.emailCanonical !== emailCanonical) throw invalidInvitation()
        }
        const { user, accountCreated } = await this.findOrCreateUser(
          tx,
          profile,
          providerName,
          stateData.locale,
          !!stateData.invitation,
          existingUser?.id,
          expectedFrontend === 'admin'
        )
        if (stateData.invitation && user.emailCanonical !== emailCanonical)
          throw invalidInvitation()
        const issuance = await this.sessionService.createSession(
          {
            userId: user.id,
            userAgent: requestInfo.userAgent,
            ipAddress: requestInfo.ipAddress,
            ...(stateData.invitation
              ? {
                  handoff: {
                    attemptId: stateData.invitation.correlation.attemptId,
                    cleanupKeyHash: stateData.invitation.cleanupKeyHash,
                  },
                }
              : {}),
          },
          tx
        )
        if (
          stateData.invitation &&
          new Date(stateData.invitation.expiresAt) <= (await invitationClock(tx))
        )
          throw invalidInvitation()
        return { user, accountCreated, ...issuance }
      },
      { maxWait: 2000, timeout: 4000 }
    )
    await this.userCacheService.invalidateUser(user.id)
    const accessClaims: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
    }

    this.logger.info({ userId: user.id, provider: providerName }, 'oauth login')
    // Copied once, when this sign-in created the account or linked this provider for the first time.
    // A repeat sign-in never copies again, so an avatar the user removed stays removed.
    if (accountCreated && !user.avatarKey && profile.avatarSourceUrl)
      this.avatarRehost.schedule(user.id, profile.avatarSourceUrl)

    return {
      mode: 'login',
      ...(stateData.returnTo ? { returnTo: stateData.returnTo } : {}),
      user: this.mapUserToResponse(user),
      refreshToken,
      sessionId: session.id,
      accessClaims,
      ...(stateData.invitation
        ? { invitation: { ...stateData.invitation.correlation, backendSessionId: session.id } }
        : {}),
    }
  }

  /**
   * Constant-time check that the `oauth_state` cookie nonce matches the hash
   * stored with the state. Throws the uniform `OAUTH_STATE_INVALID` on a missing
   * or mismatched binding (never leaks which).
   */
  private assertBrowserBinding(browserNonce: string | undefined, expectedHash: string): void {
    const invalid = (): AppException =>
      new AppException(
        'Invalid OAuth state',
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.OAUTH_STATE_INVALID
      )

    if (!browserNonce) throw invalid()

    const actual = Buffer.from(hashOAuthStateNonce(browserNonce))
    const expected = Buffer.from(expectedHash)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid()
  }

  private async attachProviderToUser(
    userId: string,
    profile: OAuthUserProfile,
    providerName: string
  ): Promise<User> {
    const provider = providerName.toUpperCase() as OAuthProvider

    const existing = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: profile.providerId } },
    })
    if (existing) {
      throw new AppException(
        'This account is already linked to another user',
        HttpStatus.CONFLICT,
        AuthErrorCode.OAUTH_ACCOUNT_ALREADY_LINKED
      )
    }

    await this.prisma.$transaction([
      this.prisma.oAuthAccount.create({
        data: { userId, provider, providerAccountId: profile.providerId },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { ...(profile.phone ? { phone: profile.phone } : {}) },
      }),
    ])

    await this.userCacheService.invalidateUser(userId)
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
  }

  private async findOrCreateUser(
    tx: Prisma.TransactionClient,
    profile: OAuthUserProfile,
    providerName: string,
    locale?: SupportedLocale,
    invited = false,
    expectedUserId?: string,
    signInOnly = false
  ): Promise<{ user: User; accountCreated: boolean }> {
    const provider = providerName.toUpperCase() as OAuthProvider

    const existing = await tx.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: profile.providerId } },
      include: { user: true },
    })
    if (existing) {
      if (existing.userId !== expectedUserId)
        throw new AppException(
          'Identity changed during sign-in',
          409,
          AuthErrorCode.OAUTH_ACCOUNT_ALREADY_LINKED
        )
      await tx.user.update({
        where: { id: existing.userId },
        data: { lastLoginAt: new Date() },
      })
      return { user: existing.user, accountCreated: false }
    }

    const emailCanonical = this.emailIdentity.canonicalize(profile.email!)
    const userByEmail = await tx.user.findUnique({ where: { emailCanonical } })
    if (userByEmail) {
      // An email claim is not proof of ownership. Existing provider-ID links above
      // remain valid; creating a new link by email requires verified ownership.
      if (!profile.emailVerified)
        throw new AppException(
          'Provider email is not verified',
          403,
          AuthErrorCode.OAUTH_EMAIL_UNVERIFIED
        )
      if (userByEmail.id !== expectedUserId)
        throw new AppException(
          'Identity changed during sign-in',
          409,
          AuthErrorCode.EMAIL_ALREADY_EXISTS
        )
      // Existing account linked by email — keep its stored locale (D2: never
      // overwrite an established preference with a browser hint).
      return {
        user: await this.linkAndReturnUser(tx, userByEmail, profile, provider),
        accountCreated: true,
      }
    }

    if (!invited && (signInOnly || !this.env.get('AUTH_PUBLIC_SIGNUP_ENABLED')))
      throw new AppException('Public signup is disabled', 403, AuthErrorCode.PUBLIC_SIGNUP_DISABLED)
    return { user: await this.createOAuthUser(tx, profile, provider, locale), accountCreated: true }
  }

  private async linkAndReturnUser(
    tx: Prisma.TransactionClient,
    existingUser: User,
    profile: OAuthUserProfile,
    provider: OAuthProvider
  ): Promise<User> {
    const shouldVerifyEmail = profile.emailVerified && !existingUser.emailVerified

    await Promise.all([
      tx.oAuthAccount.create({
        data: { userId: existingUser.id, provider, providerAccountId: profile.providerId },
      }),
      tx.user.update({
        where: { id: existingUser.id },
        data: { lastLoginAt: new Date(), ...(shouldVerifyEmail && { emailVerified: true }) },
      }),
    ])

    return tx.user.findUniqueOrThrow({ where: { id: existingUser.id } })
  }

  private createOAuthUser(
    tx: Prisma.TransactionClient,
    profile: OAuthUserProfile,
    provider: OAuthProvider,
    locale?: SupportedLocale
  ): Promise<User> {
    const email = this.emailIdentity.normalizeForStorage(profile.email!)
    const emailCanonical = this.emailIdentity.canonicalize(profile.email!)

    return tx.user.create({
      data: {
        email,
        emailCanonical,
        emailVerified: profile.emailVerified,
        name: profile.displayName,
        // Seed from the negotiated locale (D2); omit to take the DB default.
        ...(locale ? { locale } : {}),
        lastLoginAt: new Date(),
        accounts: { create: { provider, providerAccountId: profile.providerId } },
      },
    })
  }

  private mapUserToResponse(user: User): UserResponse {
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      avatarUrl: avatarUrlOf(this.storage, user.avatarKey),
      phone: user.phone,
      locale: parseSupportedLocale(user.locale),
      timezone: user.timezone,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    }
  }
}
