import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { type MfaMethod, type MfaProof, mfaProofSchema } from '@amcore/shared'

import type { Prisma } from '../../../generated/prisma/client.js'

import { MfaEncryptionService } from './mfa-encryption.service.js'
import { backupCodeHash, generateBackupCodes } from './mfa-secrets.js'
import { verifyTotp } from './mfa-totp.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

export interface VerifiedMfaProof {
  eventId: string
  method: MfaMethod
  verifiedAt: Date
  factorVersion: number
  recoveryGeneration?: number
}

/**
 * Uses the caller's transaction. The caller owns authority BEFORE consumption,
 * negative-attempt accounting, proof/effect commit and notification intent.
 */
@Injectable()
export class MfaProofRepository {
  constructor(private readonly encryption: MfaEncryptionService) {}

  async consume(
    tx: Prisma.TransactionClient,
    userId: string,
    expectedSecurityVersion: number,
    proof: MfaProof
  ): Promise<VerifiedMfaProof | null> {
    await lockMfaAccounts(tx, [userId])
    return this.consumeLocked(tx, userId, expectedSecurityVersion, proof)
  }

  /** Caller already holds context/account/flow locks in the declared order. */
  async consumeLocked(
    tx: Prisma.TransactionClient,
    userId: string,
    expectedSecurityVersion: number,
    proof: MfaProof
  ): Promise<VerifiedMfaProof | null> {
    mfaProofSchema.parse(proof)
    const now = await mfaDatabaseClock(tx)
    const account = await tx.mfaAccount.findUnique({ where: { userId } })
    const factor = await tx.mfaFactor.findUnique({ where: { userId } })
    if (
      !account ||
      account.securityVersion !== expectedSecurityVersion ||
      !factor ||
      account.emergencyRequired ||
      (proof.method === 'recovery_code' && !account.setupComplete)
    ) {
      return null
    }
    if (proof.method === 'recovery_code') {
      const consumed = await tx.mfaRecoveryCode.updateMany({
        where: {
          userId,
          generation: account.codeGeneration,
          consumedAt: null,
          hash: backupCodeHash(userId, account.codeGeneration, proof.code),
        },
        data: { consumedAt: now },
      })
      return consumed.count === 1
        ? {
            eventId: randomUUID(),
            method: proof.method,
            verifiedAt: now,
            factorVersion: factor.version,
            recoveryGeneration: account.codeGeneration,
          }
        : null
    }
    const secret = this.encryption.decrypt(userId, factor.id, factor.keyId, factor.encryptedSeed)
    const result = await verifyTotp(secret, proof.code, factor.lastAcceptedStep, now)
    if (!result.valid || !('timeStep' in result) || result.timeStep === undefined) return null
    const advanced = await tx.mfaFactor.updateMany({
      where: { id: factor.id, version: factor.version, lastAcceptedStep: factor.lastAcceptedStep },
      data: { lastAcceptedStep: BigInt(result.timeStep) },
    })
    return advanced.count === 1
      ? {
          eventId: randomUUID(),
          method: proof.method,
          verifiedAt: now,
          factorVersion: factor.version,
        }
      : null
  }

  /** Caller must already authorize fresh password+second-factor in the same tx. */
  async replaceBackupCodes(
    tx: Prisma.TransactionClient,
    userId: string,
    expectedSecurityVersion: number,
    expectedGeneration: number
  ): Promise<{ codes: string[]; generation: number } | null> {
    await lockMfaAccounts(tx, [userId])
    return this.replaceBackupCodesLocked(tx, userId, expectedSecurityVersion, expectedGeneration)
  }

  /** Caller authorizes current fresh proof after taking its ordered locks. */
  async replaceBackupCodesLocked(
    tx: Prisma.TransactionClient,
    userId: string,
    expectedSecurityVersion: number,
    expectedGeneration: number
  ): Promise<{ codes: string[]; generation: number } | null> {
    const generation = expectedGeneration + 1
    const updated = await tx.mfaAccount.updateMany({
      where: {
        userId,
        securityVersion: expectedSecurityVersion,
        codeGeneration: expectedGeneration,
      },
      data: { codeGeneration: generation },
    })
    if (updated.count !== 1) return null
    const codes = generateBackupCodes()
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } })
    await tx.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({
        userId,
        generation,
        hash: backupCodeHash(userId, generation, code),
      })),
    })
    return { codes, generation }
  }
}
