import { Inject, Injectable } from '@nestjs/common'

import { type JwtPayload, SystemRole } from '@amcore/shared'

import type { Prisma } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { accountRequiresMfa } from './mfa-account-policy.js'
import { liveFamily, requiredMfaProofs, requiredPrimaryProofs } from './mfa-policy.js'
import { readMfaPrimaryProjection } from './mfa-primary-projection.js'
import { type MfaPrimaryProjection } from './mfa-primary-projection.schema.js'
import { admitSessionAuthority, type SessionAdmission } from './mfa-session-authority.js'

export type MfaAuthorityDatabase = Pick<
  Prisma.TransactionClient,
  'user' | 'mfaProtocol' | 'authSessionFamily' | '$queryRaw'
>

/** Primary-only admission reader; no cache, refresh, publication or positive backfill. */
@Injectable()
export class MfaAuthorityReader {
  constructor(@Inject(PrismaService) private readonly prisma: MfaAuthorityDatabase) {}

  async read(
    claims: JwtPayload,
    binding: BrowserRequestBinding | null = null
  ): Promise<SessionAdmission> {
    return this.readCurrent(claims, binding)
  }

  /** Runtime rejects protected grants until the durable protocol is active. */
  async readForRuntime(
    claims: JwtPayload,
    binding: BrowserRequestBinding | null
  ): Promise<SessionAdmission> {
    return (await this.inspectForRuntime(claims, binding)).admission
  }

  async inspectForRuntime(
    claims: JwtPayload,
    binding: BrowserRequestBinding | null
  ): Promise<{ admission: SessionAdmission; currentRole?: SystemRole }> {
    if (typeof claims.sub !== 'string' || !claims.sub)
      return { admission: { kind: 'denied', reason: 'account_missing' } as SessionAdmission }
    if (claims.fid !== undefined && (typeof claims.fid !== 'string' || !claims.fid))
      return { admission: { kind: 'denied', reason: 'session_changed' } as SessionAdmission }
    const projection = await readMfaPrimaryProjection(this.prisma, {
      userId: claims.sub,
      familyId: claims.fid,
    })
    return {
      admission: this.admitProjection(projection, claims, binding),
      currentRole: projection?.user.systemRole,
    }
  }

  readPrimaryProjection(claims: JwtPayload): Promise<MfaPrimaryProjection | null> {
    if (
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      (claims.fid !== undefined && (typeof claims.fid !== 'string' || !claims.fid))
    )
      return Promise.resolve(null)
    return readMfaPrimaryProjection(this.prisma, { userId: claims.sub, familyId: claims.fid })
  }

  /** Sensitive reads share the exact account/family snapshot used for admission. */
  async readForSensitiveAction(
    claims: JwtPayload,
    binding: BrowserRequestBinding | null,
    windowSec: number
  ): Promise<SessionAdmission> {
    return this.readCurrent(claims, binding, windowSec)
  }

  private async readCurrent(
    claims: JwtPayload,
    binding: BrowserRequestBinding | null,
    windowSec?: number
  ): Promise<SessionAdmission> {
    if (typeof claims.sub !== 'string' || !claims.sub)
      return { kind: 'denied', reason: 'account_missing' }
    if (claims.fid !== undefined && (typeof claims.fid !== 'string' || !claims.fid))
      return { kind: 'denied', reason: 'session_changed' }
    const projection = await readMfaPrimaryProjection(this.prisma, {
      userId: claims.sub,
      familyId: claims.fid,
    })
    return this.admitProjection(projection, claims, binding, windowSec)
  }

  admitProjection(
    projection: MfaPrimaryProjection | null,
    claims: JwtPayload,
    binding: BrowserRequestBinding | null,
    windowSec?: number
  ): SessionAdmission {
    if (!projection) return { kind: 'denied', reason: 'account_missing' }
    const { user, family, now } = projection
    const protectedAccount =
      accountRequiresMfa({
        systemRole: user.systemRole,
        required: user.mfaAccount?.required ?? false,
        emergencyRequired: user.mfaAccount?.emergencyRequired ?? false,
        factorVersion: user.mfaFactor?.version ?? null,
      }) || claims.systemRole === SystemRole.SuperAdmin
    if (protectedAccount) {
      const protocol = projection.protocol
      if (protocol?.state !== 'active' || protocol.version !== 1)
        return { kind: 'denied', reason: 'enforcement_unavailable' }
    }
    const admission = admitSessionAuthority(
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
      now,
      binding
    )
    if (admission.kind === 'admitted' && windowSec !== undefined && claims.fid !== undefined) {
      const version = user.mfaAccount?.securityVersion ?? 0
      if (!liveFamily(family, claims.sub, version, now) || claims.securityVersion !== version)
        return { kind: 'denied', reason: 'session_changed' }
      return {
        ...admission,
        requiredProofs: protectedAccount
          ? requiredMfaProofs(family!, user.mfaFactor!.version, now, windowSec)
          : requiredPrimaryProofs(family!, now, windowSec),
      }
    }
    return admission
  }
}
