import { MFA_PROTOCOL_VERSION } from '@amcore/shared'

import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js'
import { acquireXactLock } from '../../../prisma/index.js'

import { MfaEncryptionService } from './mfa-encryption.service.js'
import { requireOfflineMfaAuthority } from './mfa-offline-authority.js'
import type { MfaSecurityEvents } from './mfa-security-events.service.js'

export interface MfaActivationEvidence {
  evidenceHash: string
  sourceCommit: string
}

/** Administrative DB-only boundary. Image evidence and actual ingress drain remain operator responsibilities. */
export class MfaDeployment {
  constructor(
    private readonly db: PrismaClient,
    private readonly encryption: MfaEncryptionService,
    private readonly events: MfaSecurityEvents
  ) {}

  async status(): Promise<{ state: string; version: number }> {
    const protocol = await this.db.mfaProtocol.findUnique({ where: { id: 'platform' } })
    return {
      state: protocol?.state ?? 'prepared',
      version: protocol?.version ?? MFA_PROTOCOL_VERSION,
    }
  }

  async preflight(): Promise<void> {
    await requireOfflineMfaAuthority(this.db)
    await this.check(this.db)
  }

  async activate(evidence: MfaActivationEvidence): Promise<'activated' | 'already_active'> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
        const role = await requireOfflineMfaAuthority(tx)
        await acquireXactLock(tx, 'mfa-deployment-protocol:v1')
        await this.check(tx)
        const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
        if (protocol?.state === 'active') return 'already_active'
        if (protocol) {
          const written = await tx.mfaProtocol.updateMany({
            where: { id: 'platform', state: 'prepared', version: MFA_PROTOCOL_VERSION },
            data: { state: 'active' },
          })
          if (written.count !== 1) throw new Error('protocol_changed')
        } else
          await tx.mfaProtocol.create({
            data: { id: 'platform', state: 'active', version: MFA_PROTOCOL_VERSION },
          })
        await this.events.protocolActivated(tx, role, evidence)
        return 'activated'
      },
      { maxWait: 2000, timeout: 4000 }
    )
  }

  private async check(
    tx: Pick<Prisma.TransactionClient, '$queryRaw' | 'mfaProtocol' | 'mfaFactor' | 'mfaAccount'>
  ): Promise<void> {
    this.encryption.assertReady()
    const protocol = await tx.mfaProtocol.findUnique({ where: { id: 'platform' } })
    if (
      protocol &&
      (protocol.version !== MFA_PROTOCOL_VERSION ||
        !['prepared', 'active'].includes(protocol.state))
    )
      throw new Error('incompatible_protocol')
    const [migration] = await tx.$queryRaw<{ complete: boolean; failed: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM public._prisma_migrations
        WHERE migration_name = '20261029110000_mfa_operation_receipts'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS complete,
        EXISTS (SELECT 1 FROM public._prisma_migrations
          WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS failed`
    if (!migration?.complete || migration.failed) throw new Error('incomplete_migrations')
    const keys = await tx.$queryRaw<{ keyId: string }[]>`
      SELECT DISTINCT "keyId" FROM core.mfa_factors
      UNION SELECT DISTINCT data->'seedDraft'->>'keyId' AS "keyId" FROM core.mfa_flows
        WHERE data->'seedDraft'->>'keyId' IS NOT NULL`
    for (const row of keys) this.encryption.assertKeyAvailable(row.keyId)
    if (
      protocol?.state !== 'active' &&
      ((await tx.mfaFactor.count()) > 0 ||
        (await tx.mfaAccount.count({ where: { required: true } })) > 0)
    )
      throw new Error('protected_data_before_activation')
  }
}
