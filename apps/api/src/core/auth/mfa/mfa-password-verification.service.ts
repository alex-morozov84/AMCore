import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'
import { z } from 'zod'

import type { Prisma } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/index.js'
import { LoginRateLimiterService } from '../login-rate-limiter.service.js'

import { type FlowRequest, type LockedMfaFlow, lockMfaFlow } from './mfa-flow-lock.js'
import { resolveFlowProofs } from './mfa-flow-proofs.js'
import {
  assertFlowDeadline,
  ExpiredDuringVerification,
  flowData,
  flowProofWindowSeconds,
  freshOAuthFlowIdentity,
  readFlowProofs,
} from './mfa-flow-state.js'
import { requiredMfaProofs } from './mfa-policy.js'
import { MfaSecurityEvents } from './mfa-security-events.service.js'
import { MfaSourceLimiterService } from './mfa-source-limiter.service.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

export interface PrimaryVerification {
  outcome:
    | 'verified'
    | 'wrong_password'
    | 'password_setup_required'
    | 'proof_required'
    | 'restart_required'
    | 'unavailable'
  requiredProofs?: Array<'password' | 'second_factor'>
}
interface PasswordSnapshot {
  hash: string
  email: string
  securityVersion: number
  verifiedAt: Date
}
type Snapshot = { password: PasswordSnapshot } | { result: PrimaryVerification }
const previousResult = z.object({ outcome: z.enum(['verified', 'wrong_password']) }).strict()

/** Expensive password work and Redis operations never hold database security locks. */
@Injectable()
export class MfaPasswordVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loginLimiter: LoginRateLimiterService,
    private readonly sourceLimiter: MfaSourceLimiterService,
    private readonly events: MfaSecurityEvents
  ) {}

  async submit(
    request: FlowRequest,
    operationId: string,
    input: string,
    source: string
  ): Promise<PrimaryVerification> {
    z.string().uuid().parse(operationId)
    z.string().min(1).max(128).parse(input)
    await this.sourceLimiter.consume('verify', source)
    try {
      const snapshot = await this.prisma.$transaction(
        (tx) => this.snapshot(tx, request, operationId),
        { maxWait: 2000, timeout: 4000 }
      )
      if ('result' in snapshot) return snapshot.result
      const { password } = snapshot
      await this.loginLimiter.check(password.email, source)
      const valid = await argon2.verify(password.hash, input)
      if (valid) await this.loginLimiter.reset(password.email, source)
      else await this.loginLimiter.consume(password.email, source)
      return await this.prisma.$transaction(
        (tx) => this.complete(tx, request, operationId, password, valid),
        { maxWait: 2000, timeout: 4000 }
      )
    } catch (error) {
      if (error instanceof ExpiredDuringVerification) return { outcome: 'restart_required' }
      throw error
    }
  }

  private async snapshot(
    tx: Prisma.TransactionClient,
    request: FlowRequest,
    operationId: string
  ): Promise<Snapshot> {
    const locked = await lockMfaFlow(tx, request)
    if (!locked) return { result: { outcome: 'restart_required' } }
    const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
    if (protocol?.state !== 'active' || protocol.version !== 1)
      return { result: { outcome: 'unavailable' } }
    const status = await this.status(tx, locked, operationId)
    if (status) return { result: status }
    const user = await tx.user.findUniqueOrThrow({
      where: { id: locked.flow.userId },
      select: { emailCanonical: true, passwordHash: true },
    })
    if (!user.passwordHash) return { result: { outcome: 'password_setup_required' } }
    const verifiedAt = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, verifiedAt)
    return {
      password: {
        hash: user.passwordHash,
        email: user.emailCanonical,
        securityVersion: locked.flow.securityVersion,
        verifiedAt,
      },
    }
  }

  private async required(
    tx: Prisma.TransactionClient,
    locked: LockedMfaFlow,
    now: Date
  ): Promise<Array<'password' | 'second_factor'>> {
    const account = await tx.mfaAccount.findUniqueOrThrow({ where: { userId: locked.flow.userId } })
    const factor = await tx.mfaFactor.findUnique({ where: { userId: locked.flow.userId } })
    return requiredMfaProofs(
      resolveFlowProofs(readFlowProofs(locked.flow.data), {
        flowId: locked.flow.id,
        sourceFamilyId: locked.flow.sourceFamilyId,
        source: locked.source,
        codeGeneration: account.codeGeneration,
      }),
      factor?.version ?? 0,
      now,
      flowProofWindowSeconds(locked.flow)
    )
  }

  private async status(
    tx: Prisma.TransactionClient,
    locked: LockedMfaFlow,
    operationId: string
  ): Promise<PrimaryVerification | null> {
    const at = await mfaDatabaseClock(tx)
    const required = await this.required(tx, locked, at)
    if (
      required.includes('password') &&
      flowData(locked.flow.data).identity &&
      !freshOAuthFlowIdentity(locked.flow.data, locked.flow.securityVersion, at)
    )
      return { outcome: 'restart_required' }
    const operation = await tx.mfaOperation.findUnique({ where: { id: operationId } })
    if (operation) {
      const parsed = previousResult.safeParse(operation.result)
      if (
        operation.flowId !== locked.flow.id ||
        operation.kind !== 'verify_password' ||
        !parsed.success
      )
        return { outcome: 'restart_required' }
      return { ...parsed.data, requiredProofs: required }
    }
    return required.includes('password')
      ? null
      : { outcome: required.length ? 'proof_required' : 'verified', requiredProofs: required }
  }

  private async complete(
    tx: Prisma.TransactionClient,
    request: FlowRequest,
    operationId: string,
    password: PasswordSnapshot,
    valid: boolean
  ): Promise<PrimaryVerification> {
    const locked = await lockMfaFlow(tx, request)
    if (!locked || locked.flow.securityVersion !== password.securityVersion)
      return { outcome: 'restart_required' }
    const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
    if (protocol?.state !== 'active' || protocol.version !== 1) return { outcome: 'unavailable' }
    const user = await tx.user.findUniqueOrThrow({
      where: { id: locked.flow.userId },
      select: { passwordHash: true, emailCanonical: true },
    })
    if (user.passwordHash !== password.hash || user.emailCanonical !== password.email)
      return { outcome: 'restart_required' }
    const status = await this.status(tx, locked, operationId)
    if (status) return status
    if (valid) {
      const proofs = readFlowProofs(locked.flow.data)
      proofs.primary = {
        eventId: randomUUID(),
        method: 'password',
        verifiedAt: password.verifiedAt.toISOString(),
        origin: { kind: 'flow', flowId: locked.flow.id },
      }
      locked.flow = await tx.mfaFlow.update({
        where: { id: locked.flow.id },
        data: { data: { ...flowData(locked.flow.data), proofs } },
      })
    } else await this.events.passwordFailed(tx, locked.flow)
    const outcome = valid ? 'verified' : 'wrong_password'
    await tx.mfaOperation.create({
      data: {
        id: operationId,
        flowId: locked.flow.id,
        kind: 'verify_password',
        result: { outcome },
      },
    })
    const now = await mfaDatabaseClock(tx)
    assertFlowDeadline(locked, now)
    if (
      flowData(locked.flow.data).identity &&
      !freshOAuthFlowIdentity(locked.flow.data, locked.flow.securityVersion, now)
    )
      throw new ExpiredDuringVerification()
    return { outcome, requiredProofs: await this.required(tx, locked, now) }
  }
}
