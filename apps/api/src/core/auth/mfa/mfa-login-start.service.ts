import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import { type BrowserReturnProof, SystemRole } from '@amcore/shared'

import { PrismaService } from '../../../prisma/index.js'
import { lockInvitationAuthAttempt } from '../../invitations/invitation-auth-handoff.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { lockBrowserLoginBinding, reserveBrowserLogin } from './browser-login-reservation.js'
import { linkReturnReservation } from './browser-return-transition.js'
import { chargeFlowStart } from './mfa-account-budgets.js'
import { accountRequiresMfa } from './mfa-account-policy.js'
import { continuationHash, directFlowBinding, type FlowRequest } from './mfa-flow-lock.js'
import {
  captureInvitationLogin,
  type InvitationLoginScope,
  type StoredInvitationIntent,
  validateInvitationIntent,
} from './mfa-invitation-intent.js'
import {
  MfaPasswordIdentityService,
  type VerifiedPasswordIdentity,
} from './mfa-password-identity.service.js'
import { mfaCredential } from './mfa-secrets.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

/** Server-owned callback snapshot. Never accepted from an HTTP request body. */
export const oauthIdentitySnapshotSchema = z
  .object({
    userId: z.string().min(1),
    emailCanonical: z.string().min(1),
    systemRole: z.enum(SystemRole),
    securityVersion: z.number().int().nonnegative(),
    protectedAccount: z.boolean(),
    verifiedAt: z.iso.datetime(),
    eventId: z.string().uuid(),
  })
  .strict()
export type OAuthIdentitySnapshot = z.infer<typeof oauthIdentitySnapshotSchema>
type LoginIdentity = Pick<
  VerifiedPasswordIdentity,
  'userId' | 'securityVersion' | 'protectedAccount' | 'verifiedAt' | 'matches'
>

export type LoginFrame =
  | { kind: 'browser'; binding: BrowserRequestBinding; returnProof?: BrowserReturnProof }
  | { kind: 'direct' }
export type LoginStart =
  | {
      kind: 'ordinary' | 'mfa' | 'recovery_ticket_required'
      request: FlowRequest
      flowId: string
      expiresAt: Date
      setupRequired: boolean
      passwordRequired?: boolean
      userId: string
      remainingCodes: number
      codeGeneration: number
    }
  | { kind: 'invalid_credentials' | 'restart_required' | 'unavailable' }
  | { kind: 'limited'; retryAfter: number }
class ReservationChanged extends Error {}

/** Internal login path only. Registration, OAuth callbacks and provider linking are separate callers. */
@Injectable()
export class MfaLoginStartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: MfaPasswordIdentityService,
    private readonly sourceLimiter: MfaSourceLimiterService
  ) {}

  async password(
    email: string,
    password: string,
    source: string,
    frame: LoginFrame,
    operationId: string,
    invited?: InvitationLoginScope
  ): Promise<LoginStart> {
    z.string().uuid().parse(operationId)
    const identity = await this.passwords.verify(email, password, source)
    if (!identity) return { kind: 'invalid_credentials' }
    return this.start(identity, source, frame, operationId, 'password', undefined, invited)
  }

  /** Only a consumed, browser-bound server ticket may supply this callback snapshot. */
  async oauth(
    snapshot: OAuthIdentitySnapshot,
    source: string,
    frame: LoginFrame,
    operationId: string,
    invited?: StoredInvitationIntent
  ): Promise<LoginStart> {
    const verified = oauthIdentitySnapshotSchema.parse(snapshot)
    const identity: LoginIdentity = {
      ...verified,
      verifiedAt: new Date(verified.verifiedAt),
      matches: (user, version) =>
        user.id === verified.userId &&
        user.emailCanonical === verified.emailCanonical &&
        user.systemRole === verified.systemRole &&
        version === verified.securityVersion,
    }
    return this.start(identity, source, frame, operationId, 'oauth', verified, invited)
  }

  private async start(
    identity: LoginIdentity,
    source: string,
    frame: LoginFrame,
    operationId: string,
    method: 'password' | 'oauth',
    oauth?: OAuthIdentitySnapshot,
    invited?: InvitationLoginScope | StoredInvitationIntent
  ): Promise<LoginStart> {
    z.string().uuid().parse(operationId)
    const identityWindow = method === 'oauth' ? 300_000 : 600_000
    // Ordinary password admission retains its existing limits; MFA-source debt covers human MFA starts.
    if (identity.protectedAccount) await this.sourceLimiter.consume('start', source)
    const credential = mfaCredential()
    const flowId = randomUUID()
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (invited) {
            if (frame.kind !== 'browser') return { kind: 'restart_required' }
            await lockInvitationAuthAttempt(tx, 'credential' in invited ? invited.handoff : invited)
          }
          const browser = frame.kind === 'browser' ? frame.binding : null
          const locked = browser
            ? await lockBrowserLoginBinding(tx, browser, identity.userId)
            : null
          if (browser && !locked) return { kind: 'restart_required' }
          if (!browser) await lockMfaAccounts(tx, [identity.userId])
          const users = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM core.users WHERE id = ${identity.userId} FOR SHARE`
          if (!users.length) return { kind: 'restart_required' }
          const user = await tx.user.findUniqueOrThrow({
            where: { id: identity.userId },
            select: { id: true, passwordHash: true, emailCanonical: true, systemRole: true },
          })
          if (browser?.audience === 'console' && user.systemRole !== SystemRole.SuperAdmin)
            return { kind: 'restart_required' }
          const stored = await tx.mfaAccount.findUnique({ where: { userId: identity.userId } })
          const factor = await tx.mfaFactor.findUnique({
            where: { userId: identity.userId },
            select: { version: true },
          })
          if (!identity.matches(user, stored?.securityVersion ?? 0))
            return { kind: 'restart_required' }
          const protectedAccount = accountRequiresMfa({
            systemRole: user.systemRole,
            required: stored?.required ?? false,
            emergencyRequired: stored?.emergencyRequired ?? false,
            factorVersion: factor?.version ?? null,
          })
          if (protectedAccount !== identity.protectedAccount) return { kind: 'restart_required' }
          if (protectedAccount) {
            const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
            if (protocol?.state !== 'active' || protocol.version !== 1)
              return { kind: 'unavailable' }
          }
          if (await tx.mfaOperation.findUnique({ where: { id: operationId } }))
            return { kind: 'restart_required' }
          let invitation: StoredInvitationIntent | null = null
          if (invited) {
            if ('credential' in invited)
              invitation = await captureInvitationLogin(tx, invited, user.emailCanonical)
            else {
              await validateInvitationIntent(tx, invited, user.emailCanonical)
              invitation = invited
            }
          }
          const now = await mfaDatabaseClock(tx)
          if (
            identity.verifiedAt > now ||
            now.getTime() - identity.verifiedAt.getTime() > identityWindow
          )
            return { kind: 'restart_required' }
          if (!stored) await tx.mfaAccount.create({ data: { userId: identity.userId } })
          if (protectedAccount) {
            const budget = await chargeFlowStart(tx, identity.userId, now, browser ?? undefined)
            if (!budget.allowed) return { kind: 'limited', retryAfter: budget.retryAfter }
          }
          const setupRequired =
            protectedAccount && (!stored?.setupComplete || !factor || !!stored?.emergencyRequired)
          const purpose = setupRequired ? 'initial_setup' : 'login'
          const expiresAt = new Date(
            Math.min(
              now.getTime() + (setupRequired ? 900_000 : 300_000),
              invitation ? Date.parse(invitation.expiresAt) : Infinity
            )
          )
          const context =
            locked && browser
              ? await reserveBrowserLogin(tx, locked, browser, flowId, expiresAt)
              : null
          if (browser && !context) throw new ReservationChanged()
          const authorityKind = stored?.emergencyRequired ? 'recovery_pending' : 'identity'
          const bindingHash = context ? browser!.bindingHash : directFlowBinding(credential)!
          const returnEntry =
            context && browser && frame.kind === 'browser' && !invitation
              ? await linkReturnReservation(
                  tx,
                  frame.returnProof,
                  browser,
                  context,
                  flowId,
                  identity.userId,
                  stored?.securityVersion ?? 0
                )
              : undefined
          await tx.mfaFlow.create({
            data: {
              id: flowId,
              credentialHash: continuationHash(credential)!,
              userId: identity.userId,
              purpose,
              authorityKind,
              audience: context ? browser!.audience : 'direct',
              bindingHash,
              securityVersion: identity.securityVersion,
              browserContextId: context?.id ?? null,
              publicationGeneration: context?.generation ?? null,
              expiresAt,
              primaryAt: method === 'password' ? identity.verifiedAt : null,
              data: {
                ...(returnEntry ? { returnEntry } : {}),
                ...(invitation ? { invitation } : {}),
                ...(oauth && {
                  identity: {
                    method: 'oauth',
                    eventId: oauth.eventId,
                    verifiedAt: oauth.verifiedAt,
                    securityVersion: oauth.securityVersion,
                  },
                }),
                proofs: {
                  primary:
                    method === 'password'
                      ? {
                          method: 'password',
                          eventId: randomUUID(),
                          verifiedAt: identity.verifiedAt.toISOString(),
                          origin: { kind: 'flow', flowId },
                        }
                      : null,
                  secondFactor: null,
                },
              },
            },
          })
          await tx.mfaOperation.create({
            data: { id: operationId, flowId, kind: 'start_login', result: { state: 'created' } },
          })
          const finalNow = await mfaDatabaseClock(tx)
          if (
            expiresAt <= finalNow ||
            identity.verifiedAt > finalNow ||
            finalNow.getTime() - identity.verifiedAt.getTime() > identityWindow
          )
            throw new ReservationChanged()
          const request: FlowRequest = {
            credential,
            purpose,
            audience: context ? browser!.audience : 'direct',
            bindingHash,
            browser: context ? { ...browser!, generation: context.generation } : null,
          }
          return {
            kind: stored?.emergencyRequired
              ? 'recovery_ticket_required'
              : protectedAccount
                ? 'mfa'
                : 'ordinary',
            request,
            flowId,
            expiresAt,
            setupRequired,
            passwordRequired: method === 'oauth' && protectedAccount,
            userId: identity.userId,
            remainingCodes: await tx.mfaRecoveryCode.count({
              where: {
                userId: identity.userId,
                generation: stored?.codeGeneration ?? 0,
                consumedAt: null,
              },
            }),
            codeGeneration: stored?.codeGeneration ?? 0,
          }
        },
        { maxWait: 2000, timeout: 4000 }
      )
    } catch (error) {
      if (error instanceof ReservationChanged) return { kind: 'restart_required' }
      throw error
    }
  }
}
