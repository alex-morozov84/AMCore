import { Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

import type { SystemRole } from '@amcore/shared'

import type { Prisma, User } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'
import { EmailIdentityService } from '../email-identity.service.js'
import { LoginRateLimiterService } from '../login-rate-limiter.service.js'

import { accountRequiresMfa } from './mfa-account-policy.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

const selection = {
  id: true,
  emailCanonical: true,
  passwordHash: true,
  systemRole: true,
  mfaAccount: { select: { securityVersion: true, required: true, emergencyRequired: true } },
  mfaFactor: { select: { version: true } },
} satisfies Prisma.UserSelect
type IdentitySnapshot = Prisma.UserGetPayload<{ select: typeof selection }>

/** Module-private value constructor: an HTTP body cannot supply a verified identity. */
class PasswordIdentity {
  readonly userId: string
  readonly systemRole: SystemRole
  readonly securityVersion: number
  readonly protectedAccount: boolean
  readonly #passwordHash: string
  readonly #email: string
  readonly #verifiedAt: number

  constructor(user: IdentitySnapshot, at: Date) {
    this.userId = user.id
    this.systemRole = user.systemRole
    this.securityVersion = user.mfaAccount?.securityVersion ?? 0
    this.protectedAccount = accountRequiresMfa({
      systemRole: user.systemRole,
      required: user.mfaAccount?.required ?? false,
      emergencyRequired: user.mfaAccount?.emergencyRequired ?? false,
      factorVersion: user.mfaFactor?.version ?? null,
    })
    this.#passwordHash = user.passwordHash!
    this.#email = user.emailCanonical
    this.#verifiedAt = at.getTime()
    Object.freeze(this)
  }

  get verifiedAt(): Date {
    return new Date(this.#verifiedAt)
  }

  matches(
    user: Pick<User, 'id' | 'passwordHash' | 'emailCanonical' | 'systemRole'>,
    version: number
  ): boolean {
    return (
      user.id === this.userId &&
      user.passwordHash === this.#passwordHash &&
      user.emailCanonical === this.#email &&
      user.systemRole === this.systemRole &&
      version === this.securityVersion
    )
  }
}
export type VerifiedPasswordIdentity = PasswordIdentity

/** Keeps T075 check/consume/reset semantics; never holds a security lock during Argon2 or Redis. */
@Injectable()
export class MfaPasswordIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: EmailIdentityService,
    private readonly limiter: LoginRateLimiterService
  ) {}

  async verify(
    email: string,
    password: string,
    source: string
  ): Promise<VerifiedPasswordIdentity | null> {
    const canonical = this.emails.canonicalize(email)
    await this.limiter.check(canonical, source)
    const user = await this.prisma.user.findUnique({
      where: { emailCanonical: canonical },
      select: selection,
    })
    // Use the pre-verification clock so pool or limiter waits cannot freshen evidence.
    const at = await mfaDatabaseClock(this.prisma)
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, password))) {
      await this.limiter.consume(canonical, source)
      return null
    }
    await this.limiter.reset(canonical, source)
    return new PasswordIdentity(user, at)
  }
}
