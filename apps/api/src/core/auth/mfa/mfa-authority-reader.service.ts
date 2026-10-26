import { Injectable } from '@nestjs/common'

import { type JwtPayload, SystemRole } from '@amcore/shared'

import type { MfaAccount, MfaFactor, User } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { accountRequiresMfa } from './mfa-account-policy.js'
import {
  admitSessionAuthority,
  type BrowserPublicationAuthority,
  type SessionAdmission,
  type SessionFamilyAuthority,
} from './mfa-session-authority.js'

type CurrentAccount = Pick<User, 'id' | 'systemRole'> & {
  mfaAccount: Pick<
    MfaAccount,
    'securityVersion' | 'required' | 'setupComplete' | 'emergencyRequired'
  > | null
  mfaFactor: Pick<MfaFactor, 'version'> | null
}
type CurrentFamily = SessionFamilyAuthority & { browserContext: BrowserPublicationAuthority | null }

/** Primary-only admission reader; no cache, refresh, publication or positive backfill. */
@Injectable()
export class MfaAuthorityReader {
  constructor(private readonly prisma: PrismaService) {}

  async read(
    claims: JwtPayload,
    binding: BrowserRequestBinding | null = null
  ): Promise<SessionAdmission> {
    if (typeof claims.sub !== 'string' || !claims.sub)
      return { kind: 'denied', reason: 'account_missing' }
    if (claims.fid !== undefined && (typeof claims.fid !== 'string' || !claims.fid))
      return { kind: 'denied', reason: 'session_changed' }
    const user = await this.readAccount(claims.sub)
    if (!user) return { kind: 'denied', reason: 'account_missing' }
    if (
      accountRequiresMfa({
        systemRole: user.systemRole,
        required: user.mfaAccount?.required ?? false,
        emergencyRequired: user.mfaAccount?.emergencyRequired ?? false,
        factorVersion: user.mfaFactor?.version ?? null,
      }) ||
      claims.systemRole === SystemRole.SuperAdmin
    ) {
      const protocol = await this.prisma.mfaProtocol.findUnique({ where: { id: 'platform' } })
      if (protocol?.state !== 'active' || protocol.version !== 1)
        return { kind: 'denied', reason: 'enforcement_unavailable' }
    }
    const family = await this.readFamily(claims.fid)
    const [clock] = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    if (!clock) throw new Error('MFA admission clock unavailable')
    return admitSessionAuthority(
      claims,
      {
        userId: user.id,
        systemRole: user.systemRole,
        securityVersion: user.mfaAccount?.securityVersion ?? 0,
        required: user.mfaAccount?.required ?? false,
        setupComplete: user.mfaAccount?.setupComplete ?? false,
        emergencyRequired: user.mfaAccount?.emergencyRequired ?? false,
        factorVersion: user.mfaFactor?.version ?? null,
      },
      family,
      family?.browserContext ?? null,
      clock.now,
      binding
    )
  }

  private readAccount(userId: string): Promise<CurrentAccount | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        systemRole: true,
        mfaAccount: {
          select: {
            securityVersion: true,
            required: true,
            setupComplete: true,
            emergencyRequired: true,
          },
        },
        mfaFactor: { select: { version: true } },
      },
    })
  }

  private readFamily(familyId?: string): Promise<CurrentFamily | null> {
    return familyId
      ? this.prisma.authSessionFamily.findUnique({
          where: { id: familyId },
          select: {
            id: true,
            userId: true,
            securityVersion: true,
            expiresAt: true,
            revokedAt: true,
            publicationState: true,
            primaryMethod: true,
            primaryAt: true,
            primaryProofId: true,
            mfaMethod: true,
            mfaAt: true,
            mfaProofId: true,
            factorVersion: true,
            browserContextId: true,
            publicationGeneration: true,
            browserContext: {
              select: {
                bindingHash: true,
                audience: true,
                id: true,
                generation: true,
                currentFamilyId: true,
                state: true,
                expiresAt: true,
              },
            },
          },
        })
      : Promise.resolve(null)
  }
}
