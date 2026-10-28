import { Injectable } from '@nestjs/common'

import {
  AuditActorType,
  AuditTargetType,
  type MfaFlow,
  type Prisma,
} from '../../../generated/prisma/client.js'
import { AuditLogService } from '../../audit/index.js'
import { NotificationsService } from '../../notifications/notifications.service.js'

import type { VerifiedMfaProof } from './mfa-proof.repository.js'

/** Mandatory transactional audit/intent; delivery runs after commit through existing dispatch. */
@Injectable()
export class MfaSecurityEvents {
  constructor(
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService
  ) {}

  async protocolActivated(
    tx: Prisma.TransactionClient,
    actorDatabaseRole: string,
    evidence: { evidenceHash: string; sourceCommit: string }
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'auth.mfa_protocol_activated',
        actorType: AuditActorType.SYSTEM,
        targetType: AuditTargetType.RUNTIME_SETTING,
        targetId: 'auth.mfa.protocol',
        metadata: { actorDatabaseRole, ...evidence },
      },
      { tx }
    )
  }

  async recoveryReset(
    tx: Prisma.TransactionClient,
    userId: string,
    operationId: string,
    actorDatabaseRole: string,
    reason: string,
    changedAt: Date
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'auth.mfa_offline_recovery_started',
        actorType: AuditActorType.SYSTEM,
        targetType: AuditTargetType.USER,
        targetId: userId,
        metadata: { operationId, actorDatabaseRole, reason },
      },
      { tx }
    )
    await this.notifications.notifyTx(tx, {
      recipientUserId: userId,
      type: 'account.mfa_factor_changed',
      payload: { change: 'recovery_started', changedAt: changedAt.toISOString() },
      occurredAt: changedAt,
      idempotencyKey: `auth.mfa_offline_recovery_started:${operationId}`,
    })
  }

  async ticketRedeemed(
    tx: Prisma.TransactionClient,
    flow: MfaFlow,
    operationId: string
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'auth.mfa_recovery_ticket_redeemed',
        actorType: AuditActorType.USER,
        actorId: flow.userId,
        targetType: AuditTargetType.USER,
        targetId: flow.userId,
        metadata: { operationId },
      },
      { tx }
    )
  }

  async passwordFailed(tx: Prisma.TransactionClient, flow: MfaFlow): Promise<void> {
    await this.audit.record(
      {
        action: 'auth.step_up_failed',
        actorType: AuditActorType.USER,
        actorId: flow.userId,
        targetType: AuditTargetType.USER,
        targetId: flow.userId,
        metadata: { reason: 'invalid_password' },
      },
      { tx }
    )
  }

  async reauthenticated(
    tx: Prisma.TransactionClient,
    flow: MfaFlow,
    sessionId: string
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'auth.step_up_succeeded',
        actorType: AuditActorType.USER,
        actorId: flow.userId,
        targetType: AuditTargetType.USER,
        targetId: flow.userId,
        metadata: { sessionId },
      },
      { tx }
    )
  }

  async failed(tx: Prisma.TransactionClient, flow: MfaFlow, operationId: string): Promise<void> {
    await this.audit.record(
      {
        action: 'auth.mfa_verification_failed',
        actorType: AuditActorType.USER,
        actorId: flow.userId,
        targetType: AuditTargetType.USER,
        targetId: flow.userId,
        metadata: { operationId, reason: 'invalid_code' },
      },
      { tx }
    )
  }

  async backupCodesChanged(
    tx: Prisma.TransactionClient,
    flow: MfaFlow,
    operationId: string,
    generation: number,
    changedAt: Date
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'auth.mfa_backup_codes_replaced',
        actorType: AuditActorType.USER,
        actorId: flow.userId,
        targetType: AuditTargetType.USER,
        targetId: flow.userId,
        metadata: { operationId, generation },
      },
      { tx }
    )
    await this.notifications.notifyTx(tx, {
      recipientUserId: flow.userId,
      type: 'account.mfa_backup_codes_changed',
      payload: { changedAt: changedAt.toISOString() },
      occurredAt: changedAt,
      idempotencyKey: `auth.mfa_backup_codes_replaced:${operationId}`,
    })
  }

  async setupAcknowledged(
    tx: Prisma.TransactionClient,
    flow: MfaFlow,
    operationId: string,
    generation: number
  ): Promise<void> {
    await this.audit.record(
      {
        action:
          flow.purpose === 'rotate_codes'
            ? 'auth.mfa_backup_codes_saved'
            : 'auth.mfa_setup_completed',
        actorType: AuditActorType.USER,
        actorId: flow.userId,
        targetType: AuditTargetType.USER,
        targetId: flow.userId,
        metadata: { operationId, generation },
      },
      { tx }
    )
  }

  async factorBound(
    tx: Prisma.TransactionClient,
    flow: MfaFlow,
    operationId: string,
    factorVersion: number,
    changedAt: Date
  ): Promise<void> {
    const change = flow.purpose === 'replace_factor' ? 'replaced' : 'enrolled'
    await this.audit.record(
      {
        action: change === 'replaced' ? 'auth.mfa_factor_replaced' : 'auth.mfa_factor_enrolled',
        actorType: AuditActorType.USER,
        actorId: flow.userId,
        targetType: AuditTargetType.USER,
        targetId: flow.userId,
        metadata: { operationId, factorVersion },
      },
      { tx }
    )
    await this.notifications.notifyTx(tx, {
      recipientUserId: flow.userId,
      type: 'account.mfa_factor_changed',
      payload: { change, changedAt: changedAt.toISOString() },
      occurredAt: changedAt,
      idempotencyKey: `auth.mfa_factor_changed:${operationId}`,
    })
  }

  async verified(
    tx: Prisma.TransactionClient,
    flow: MfaFlow,
    operationId: string,
    proof: VerifiedMfaProof
  ): Promise<void> {
    await this.audit.record(
      {
        action:
          proof.method === 'recovery_code'
            ? 'auth.mfa_backup_code_used'
            : 'auth.mfa_proof_verified',
        actorType: AuditActorType.USER,
        actorId: flow.userId,
        targetType: AuditTargetType.USER,
        targetId: flow.userId,
        metadata: { operationId, method: proof.method },
      },
      { tx }
    )
    if (proof.method === 'recovery_code') {
      await this.notifications.notifyTx(tx, {
        recipientUserId: flow.userId,
        type: 'account.mfa_backup_used',
        payload: { usedAt: proof.verifiedAt.toISOString() },
        occurredAt: proof.verifiedAt,
        idempotencyKey: `auth.mfa_backup_code_used:${proof.eventId}`,
      })
    }
  }
}
