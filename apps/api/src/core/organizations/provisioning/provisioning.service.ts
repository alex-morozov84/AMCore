import { Injectable } from '@nestjs/common'

import {
  type ProvisioningCreate,
  provisioningCreateSchema,
  type ProvisioningLookup,
  type ProvisioningProgress,
  provisioningProgressSchema,
} from '@amcore/shared'

import { EnvService } from '../../../env/env.service.js'
import { PrismaService } from '../../../prisma/index.js'
import { EmailIdentityService } from '../../auth/email-identity.service.js'
import { InvitationEmailService } from '../invitation-email.service.js'
import { admitSetupOperator, type SetupOperator } from '../organization-setup-admission.js'

import { createProvisioning } from './provisioning-create.js'
import { provisioningError } from './provisioning-error.js'
import {
  lockProvisioningCreation,
  provisioningAge,
  provisioningReceipt,
} from './provisioning-identity.js'
import { ProvisioningLimiterService } from './provisioning-limiter.service.js'
import { dispatchProvisioningMail } from './provisioning-mail.js'
import { readProvisioning } from './provisioning-read.js'
import { type ProvisioningCommand,recoverProvisioning } from './provisioning-recovery.js'
import { provisioningTransaction } from './provisioning-transaction.js'

@Injectable()
export class ProvisioningService {
  constructor(
    private readonly db: PrismaService,
    private readonly env: EnvService,
    private readonly identity: EmailIdentityService,
    private readonly limiter: ProvisioningLimiterService,
    private readonly email: InvitationEmailService
  ) {}

  private policy(): ProvisioningProgress['policy'] {
    const mock = this.env.get('EMAIL_PROVIDER') === 'mock'
    return {
      role: 'ADMIN',
      mailMode: mock ? 'mock' : 'provider',
      createAllowed: !(mock && this.env.get('NODE_ENV') === 'production'),
    }
  }
  private assertMailReady(): void {
    if (!this.policy().createAllowed)
      throw provisioningError('PROVISIONING_EMAIL_NOT_CONFIGURED', 503)
  }
  private async readAuthority(
    tx: Parameters<typeof admitSetupOperator>[0],
    operator: SetupOperator
  ): Promise<void> {
    if (operator.principal.organizationId) throw provisioningError('FORBIDDEN', 403)
    await admitSetupOperator(tx, operator)
  }
  async readiness(operator: SetupOperator): Promise<ProvisioningProgress['policy']> {
    return provisioningTransaction(this.db, async (tx) => {
      await this.readAuthority(tx, operator)
      return this.policy()
    })
  }
  async create(
    input: ProvisioningCreate,
    operator: SetupOperator
  ): Promise<ReturnType<typeof provisioningReceipt>> {
    input = provisioningCreateSchema.parse({
      ...input,
      firstAdminEmail: this.identity.canonicalize(input.firstAdminEmail),
    })
    const result = await provisioningTransaction(this.db, (tx) =>
      createProvisioning(tx, input, operator, this.limiter, () => this.assertMailReady())
    )
    await dispatchProvisioningMail(
      this.db,
      this.email,
      result.mail,
      this.policy().mailMode === 'mock'
    )
    return result.receipt
  }
  async lookup(operationId: string, operator: SetupOperator): Promise<ProvisioningLookup> {
    return provisioningTransaction(this.db, async (tx) => {
      await lockProvisioningCreation(tx, operationId)
      await this.readAuthority(tx, operator)
      const row = await tx.organizationProvisioning.findUnique({ where: { operationId } })
      if (row) return { state: 'committed', receipt: provisioningReceipt(row) }
      const age = await provisioningAge(tx, operationId)
      return age > 86_400_000
        ? { state: 'expired_unrecorded' }
        : { state: 'unrecorded', sameIdAdmissible: age >= -300_000 }
    })
  }
  async progress(orgId: string, operator: SetupOperator): Promise<ProvisioningProgress> {
    return provisioningTransaction(this.db, async (tx) => {
      await this.readAuthority(tx, operator)
      return provisioningProgressSchema.parse(await readProvisioning(tx, orgId, this.policy()))
    })
  }
  async recover(
    orgId: string,
    command: ProvisioningCommand,
    operator: SetupOperator
  ): Promise<{ operationId: string; organizationId: string; revision: number }> {
    if (command.kind === 'replace')
      command = {
        kind: 'replace',
        input: {
          ...command.input,
          firstAdminEmail: this.identity.canonicalize(command.input.firstAdminEmail),
        },
      }
    const result = await provisioningTransaction(this.db, (tx) =>
      recoverProvisioning(tx, orgId, command, operator, this.limiter, () => this.assertMailReady())
    )
    await dispatchProvisioningMail(
      this.db,
      this.email,
      result.mail,
      this.policy().mailMode === 'mock'
    )
    return result.receipt
  }
}
