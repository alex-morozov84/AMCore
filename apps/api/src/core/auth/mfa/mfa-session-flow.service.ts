import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { z } from 'zod'

import type { MfaSettingsStartInput, MfaSettingsStartStatus } from '@amcore/shared'

import { EnvService } from '../../../env/env.service.js'
import { PrismaService } from '../../../prisma/index.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { chargeFlowStart } from './mfa-account-budgets.js'
import { accountRequiresMfa } from './mfa-account-policy.js'
import { familyProofReferences } from './mfa-family-proof-references.js'
import { continuationHash, directFlowBinding, type FlowRequest } from './mfa-flow-lock.js'
import { mfaCredential } from './mfa-secrets.js'
import { admitSessionAuthority } from './mfa-session-authority.js'
import { mfaSourceSessionClaimsSchema as claimsSchema } from './mfa-session-claims.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

const purposeSchema = z.enum(['reauthenticate', 'replace_factor', 'rotate_codes'])
type SessionFlow =
  | { kind: 'flow'; request: FlowRequest; flowId: string; expiresAt: Date }
  | { kind: 'limited'; retryAfter: number }
  | { kind: 'restart_required' | 'unavailable' }
  | { kind: 'recorded'; status: MfaSettingsStartStatus }
class StartExpired extends Error {}

/** Verifies the original signed credential, then captures ONLY its exact current F. */
@Injectable()
export class MfaSessionFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sourceLimiter: MfaSourceLimiterService,
    private readonly env: EnvService
  ) {}

  async start(
    accessToken: string,
    browser: BrowserRequestBinding | null,
    purpose: z.infer<typeof purposeSchema>,
    operationId: string,
    source: string,
    requestedWindowSeconds?: number,
    settingsStart?: MfaSettingsStartInput
  ): Promise<SessionFlow> {
    purposeSchema.parse(purpose)
    z.string().uuid().parse(operationId)
    if (requestedWindowSeconds !== undefined)
      z.number().int().min(1).max(600).parse(requestedWindowSeconds)
    const proofWindowSeconds = Math.min(
      600,
      this.env.get('STEP_UP_MAX_AGE_SECONDS'),
      requestedWindowSeconds ?? 600
    )
    let claims: z.infer<typeof claimsSchema>
    try {
      claims = claimsSchema.parse(this.jwt.verify(accessToken, { algorithms: ['HS256'] }))
    } catch {
      return { kind: 'restart_required' }
    }
    await this.sourceLimiter.consume('start', source)
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
          if (browser)
            await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${browser.contextId} FOR UPDATE`
          await lockMfaAccounts(tx, [claims.sub])
          await tx.$queryRaw`SELECT id FROM core.users WHERE id = ${claims.sub} FOR SHARE`
          const user = await tx.user.findUnique({
            where: { id: claims.sub },
            select: { systemRole: true },
          })
          const account = await tx.mfaAccount.findUnique({ where: { userId: claims.sub } })
          const factor = await tx.mfaFactor.findUnique({ where: { userId: claims.sub } })
          if (!user || !account || !factor) return { kind: 'restart_required' }
          const protection = {
            ...account,
            systemRole: user.systemRole,
            factorVersion: factor.version,
          }
          if (!accountRequiresMfa(protection)) return { kind: 'restart_required' }
          const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
          if (protocol?.state !== 'active' || protocol.version !== 1) return { kind: 'unavailable' }
          const family = await tx.authSessionFamily.findUnique({ where: { id: claims.fid } })
          const context = family?.browserContextId
            ? await tx.browserAuthContext.findUnique({ where: { id: family.browserContextId } })
            : null
          const now = await mfaDatabaseClock(tx)
          if (
            claims.exp * 1000 <= now.getTime() ||
            admitSessionAuthority(
              claims,
              { ...protection, userId: claims.sub },
              family,
              context,
              now,
              browser
            ).kind !== 'admitted'
          )
            return { kind: 'restart_required' }
          if (settingsStart) {
            if (!browser || !claims.browserBound || purpose === 'reauthenticate')
              return { kind: 'restart_required' }
            const receipt = await tx.mfaSettingsStartReceipt.findUnique({ where: { operationId } })
            if (receipt) {
              if (
                receipt.userId !== claims.sub ||
                receipt.sourceFamilyId !== claims.fid ||
                receipt.sourceSecurityVersion !== claims.securityVersion ||
                receipt.purpose !== purpose ||
                receipt.browserContextId !== browser.contextId ||
                receipt.generation !== browser.generation ||
                receipt.audience !== browser.audience ||
                receipt.bindingHash !== browser.bindingHash ||
                receipt.startNotAfter.toISOString() !== settingsStart.startNotAfter
              )
                return { kind: 'restart_required' }
              return {
                kind: 'recorded',
                status: {
                  state:
                    receipt.expiresAt <= now
                      ? 'expired'
                      : receipt.state === 'abandoned'
                        ? 'abandoned'
                        : 'created',
                  ...(receipt.flowId ? { flowId: receipt.flowId } : {}),
                  expiresAt: receipt.expiresAt.toISOString(),
                },
              }
            }
            const deadline = Date.parse(settingsStart.startNotAfter)
            if (deadline <= now.getTime() || deadline > now.getTime() + 30000)
              return { kind: 'restart_required' }
          }
          if (await tx.mfaOperation.findUnique({ where: { id: operationId } }))
            return { kind: 'restart_required' }
          const budget = await chargeFlowStart(tx, claims.sub, now)
          if (!budget.allowed) return { kind: 'limited', retryAfter: budget.retryAfter }
          const credential = mfaCredential()
          const flowId = randomUUID()
          const expiresAt = new Date(
            Math.min(
              now.getTime() + (purpose === 'replace_factor' ? 900_000 : 300_000),
              family!.expiresAt.getTime(),
              context?.expiresAt.getTime() ?? Infinity
            )
          )
          const bindingHash = browser?.bindingHash ?? directFlowBinding(credential)!
          await tx.mfaFlow.create({
            data: {
              id: flowId,
              userId: claims.sub,
              credentialHash: continuationHash(credential)!,
              purpose,
              authorityKind: 'session',
              sourceFamilyId: family!.id,
              sourceSecurityVersion: account.securityVersion,
              securityVersion: account.securityVersion,
              browserContextId: context?.id ?? null,
              publicationGeneration: context?.generation ?? null,
              bindingHash,
              audience: browser?.audience ?? 'direct',
              expiresAt,
              data: {
                proofs: familyProofReferences(family!),
                ...(purpose === 'reauthenticate' && { proofWindowSeconds }),
              },
            },
          })
          await tx.mfaOperation.create({
            data: {
              id: operationId,
              flowId,
              kind: 'start_session_flow',
              result: { state: 'created' },
            },
          })
          if (settingsStart && browser)
            await tx.mfaSettingsStartReceipt.create({
              data: {
                operationId,
                userId: claims.sub,
                sourceFamilyId: claims.fid,
                sourceSecurityVersion: account.securityVersion,
                sourceSessionId: claims.sid,
                browserContextId: browser.contextId,
                generation: browser.generation,
                audience: browser.audience,
                bindingHash: browser.bindingHash,
                purpose,
                startNotAfter: new Date(settingsStart.startNotAfter),
                state: 'created',
                flowId,
                expiresAt,
              },
            })
          const finalNow = await mfaDatabaseClock(tx)
          if (
            expiresAt <= finalNow ||
            claims.exp * 1000 <= finalNow.getTime() ||
            (settingsStart && Date.parse(settingsStart.startNotAfter) <= finalNow.getTime())
          )
            throw new StartExpired()
          return {
            kind: 'flow',
            flowId,
            expiresAt,
            request: {
              credential,
              purpose,
              bindingHash,
              audience: browser?.audience ?? 'direct',
              browser,
            },
          }
        },
        { maxWait: 2000, timeout: 4000 }
      )
    } catch (error) {
      if (error instanceof StartExpired) return { kind: 'restart_required' }
      throw error
    }
  }
}
