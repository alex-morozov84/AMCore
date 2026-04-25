import { HttpStatus, Injectable, Logger } from '@nestjs/common'
import type { OAuthProvider, User } from '@prisma/client'
import { randomBytes } from 'crypto'

import type { OAuthUserProfile, UserResponse } from '@amcore/shared'
import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'
import { PrismaService } from '../../../prisma'
import { EmailIdentityService } from '../email-identity.service'
import { SessionService } from '../session.service'
import type { AccessTokenPayload } from '../token.service'
import { UserCacheService } from '../user-cache.service'

import { OAuthStateService } from './oauth-state.service'
import { OAuthProviderFactory } from './providers/oauth-provider.factory'

interface LoginCallbackResult {
  mode: 'login'
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
  private readonly logger = new Logger(OAuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly userCacheService: UserCacheService,
    private readonly providerFactory: OAuthProviderFactory,
    private readonly stateService: OAuthStateService,
    private readonly emailIdentity: EmailIdentityService
  ) {}

  async getAuthorizationURL(providerName: string): Promise<{ url: string }> {
    const provider = this.providerFactory.get(providerName)
    const state = randomBytes(32).toString('base64url')
    const codeVerifier = randomBytes(32).toString('base64url')

    await this.stateService.store(state, { provider: providerName, codeVerifier, mode: 'login' })

    const url = await provider.getAuthorizationURL(state, codeVerifier)
    return { url: url.toString() }
  }

  async getLinkAuthorizationURL(providerName: string, userId: string): Promise<{ url: string }> {
    const provider = this.providerFactory.get(providerName)
    const state = randomBytes(32).toString('base64url')
    const codeVerifier = randomBytes(32).toString('base64url')

    await this.stateService.store(state, {
      provider: providerName,
      codeVerifier,
      mode: 'link',
      userId,
    })

    const url = await provider.getAuthorizationURL(state, codeVerifier)
    return { url: url.toString() }
  }

  async handleCallback(
    providerName: string,
    code: string,
    state: string,
    requestInfo: RequestInfo
  ): Promise<CallbackResult> {
    const stateData = await this.stateService.consume(state)
    if (!stateData || stateData.provider !== providerName) {
      throw new AppException(
        'Invalid OAuth state',
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.OAUTH_STATE_INVALID
      )
    }

    const provider = this.providerFactory.get(providerName)
    const tokens = await provider.exchangeCode(code, stateData.codeVerifier)
    const profile = await provider.getUserProfile(tokens)

    if (stateData.mode === 'link') {
      const user = await this.attachProviderToUser(stateData.userId!, profile, providerName)
      this.logger.log({ msg: 'oauth link', userId: stateData.userId, provider: providerName })
      return { mode: 'link', user: this.mapUserToResponse(user) }
    }

    if (!profile.email) {
      throw new AppException(
        'Email is required',
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.OAUTH_EMAIL_REQUIRED
      )
    }

    const user = await this.findOrCreateUser(profile, providerName)

    const accessClaims: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
    }
    const { session, refreshToken } = await this.sessionService.createSession({
      userId: user.id,
      userAgent: requestInfo.userAgent,
      ipAddress: requestInfo.ipAddress,
    })

    this.logger.log({ msg: 'oauth login', userId: user.id, provider: providerName })

    return {
      mode: 'login',
      user: this.mapUserToResponse(user),
      refreshToken,
      sessionId: session.id,
      accessClaims,
    }
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

  private async findOrCreateUser(profile: OAuthUserProfile, providerName: string): Promise<User> {
    const provider = providerName.toUpperCase() as OAuthProvider

    const existing = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: profile.providerId } },
      include: { user: true },
    })
    if (existing) {
      await this.prisma.user.update({
        where: { id: existing.userId },
        data: { lastLoginAt: new Date() },
      })
      return existing.user
    }

    const emailCanonical = this.emailIdentity.canonicalize(profile.email!)
    const userByEmail = await this.prisma.user.findUnique({ where: { emailCanonical } })
    if (userByEmail) {
      return this.linkAndReturnUser(userByEmail, profile, provider)
    }

    return this.createOAuthUser(profile, provider)
  }

  private async linkAndReturnUser(
    existingUser: User,
    profile: OAuthUserProfile,
    provider: OAuthProvider
  ): Promise<User> {
    const shouldVerifyEmail = profile.emailVerified && !existingUser.emailVerified

    await this.prisma.$transaction([
      this.prisma.oAuthAccount.create({
        data: { userId: existingUser.id, provider, providerAccountId: profile.providerId },
      }),
      this.prisma.user.update({
        where: { id: existingUser.id },
        data: { lastLoginAt: new Date(), ...(shouldVerifyEmail && { emailVerified: true }) },
      }),
    ])

    await this.userCacheService.invalidateUser(existingUser.id)
    return this.prisma.user.findUniqueOrThrow({ where: { id: existingUser.id } })
  }

  private createOAuthUser(profile: OAuthUserProfile, provider: OAuthProvider): Promise<User> {
    const email = this.emailIdentity.normalizeForStorage(profile.email!)
    const emailCanonical = this.emailIdentity.canonicalize(profile.email!)

    return this.prisma.user.create({
      data: {
        email,
        emailCanonical,
        emailVerified: profile.emailVerified,
        name: profile.displayName,
        avatarUrl: profile.avatarUrl,
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
      avatarUrl: user.avatarUrl,
      phone: user.phone,
      locale: user.locale,
      timezone: user.timezone,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    }
  }
}
