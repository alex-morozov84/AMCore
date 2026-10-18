import { Injectable } from '@nestjs/common'

import {
  type AdministratorAssignment,
  type AdministratorAssignmentReceipt,
  administratorAssignmentReceiptSchema,
  type AdministratorAttentionQuery,
  type AdministratorCommandReceipt,
  administratorCommandReceiptSchema,
  type AdministratorOperation,
  administratorOperationSchema,
  type AdministratorSummaryQuery,
  type ProvisioningProgress,
} from '@amcore/shared'

import { EnvService } from '../../../env/env.service.js'
import { PrismaService } from '../../../prisma/index.js'
import { AuditLogService } from '../../audit/index.js'
import { EmailIdentityService } from '../../auth/email-identity.service.js'
import { InvitationEmailService } from '../invitation-email.service.js'
import { admitSetupOperator, type SetupOperator } from '../organization-setup-admission.js'
import { OrganizationsService } from '../organizations.service.js'
import { provisioningError as fail } from '../provisioning/provisioning-error.js'
import { provisioningAge } from '../provisioning/provisioning-identity.js'
import { ProvisioningLimiterService } from '../provisioning/provisioning-limiter.service.js'
import { dispatchProvisioningMail } from '../provisioning/provisioning-mail.js'

import { assignAdministrator } from './administrator-assignment.js'
import { type AdministratorCommand, administratorCommand } from './administrator-command.js'
import { lockAdministratorOperation } from './administrator-operation.js'
import { readAdministratorAttention, readAdministratorInvitation } from './administrator-read.js'
import { readAdministratorSummary } from './administrator-summary.js'
import { administratorTransaction } from './administrator-transaction.js'

@Injectable()
export class AdministrationService {
  constructor(
    private readonly db: PrismaService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
    private readonly identity: EmailIdentityService,
    private readonly limiter: ProvisioningLimiterService,
    private readonly email: InvitationEmailService,
    private readonly organizations: OrganizationsService
  ) {}
  private policy(): ProvisioningProgress['policy'] {
    const mock = this.env.get('EMAIL_PROVIDER') === 'mock'
    return {
      role: 'ADMIN',
      mailMode: mock ? 'mock' : 'provider',
      createAllowed: !(mock && this.env.get('NODE_ENV') === 'production'),
    }
  }
  private read<T>(
    operator: SetupOperator,
    work: (tx: Parameters<typeof admitSetupOperator>[0]) => Promise<T>
  ): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        if (operator.principal.organizationId) throw fail('FORBIDDEN', 403)
        await admitSetupOperator(tx, operator)
        return work(tx)
      },
      { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 4000 }
    )
  }
  attention(
    query: AdministratorAttentionQuery,
    operator: SetupOperator
  ): ReturnType<typeof readAdministratorAttention> {
    return this.read(operator, (tx) => readAdministratorAttention(tx, query))
  }
  summary(
    orgId: string,
    query: AdministratorSummaryQuery,
    operator: SetupOperator
  ): ReturnType<typeof readAdministratorSummary> {
    return this.read(operator, (tx) => readAdministratorSummary(tx, orgId, query, this.policy()))
  }
  progress(
    orgId: string,
    id: string,
    operator: SetupOperator
  ): ReturnType<typeof readAdministratorInvitation> {
    return this.read(operator, (tx) => readAdministratorInvitation(tx, orgId, id))
  }
  async command(
    orgId: string,
    command: AdministratorCommand,
    operator: SetupOperator
  ): Promise<AdministratorCommandReceipt> {
    if (command.kind === 'create')
      command = {
        ...command,
        input: { ...command.input, email: this.identity.canonicalize(command.input.email) },
      }
    if (command.kind === 'replace')
      command = {
        ...command,
        input: { ...command.input, email: this.identity.canonicalize(command.input.email) },
      }
    const result = await administratorTransaction(this.db, (tx) =>
      administratorCommand(tx, orgId, command, {
        operator,
        limiter: this.limiter,
        audit: this.audit,
        assertMailReady: () => {
          if (!this.policy().createAllowed) throw fail('PROVISIONING_EMAIL_NOT_CONFIGURED', 503)
        },
      })
    )
    await dispatchProvisioningMail(
      this.db,
      this.email,
      result.mail,
      this.policy().mailMode === 'mock'
    )
    return administratorCommandReceiptSchema.parse(result.receipt)
  }
  async assign(
    orgId: string,
    input: AdministratorAssignment,
    operator: SetupOperator
  ): Promise<AdministratorAssignmentReceipt> {
    const result = await administratorTransaction(this.db, (tx) =>
      assignAdministrator(tx, orgId, input, operator, this.audit)
    )
    await this.organizations.invalidateAclVersion(orgId).catch(() => undefined)
    return administratorAssignmentReceiptSchema.parse(result)
  }
  async lookup(
    orgId: string,
    operationId: string,
    operator: SetupOperator
  ): Promise<AdministratorOperation> {
    return administratorTransaction(this.db, async (tx) => {
      const row = await lockAdministratorOperation(tx, operator.principal.sub, orgId, operationId)
      if (operator.principal.organizationId) throw fail('FORBIDDEN', 403)
      await admitSetupOperator(tx, operator)
      if (row && Date.now() - row.completedAt.getTime() < 30 * 86400000)
        return administratorOperationSchema.parse({ state: 'committed', receipt: row.result })
      const created = await tx.organizationAdministratorInvitation.findUnique({
        where: { id: operationId },
      })
      if (created && created.organizationId === orgId) {
        if (created.creatorUserId !== operator.principal.sub)
          throw fail('ADMIN_OPERATION_OWNED_BY_OTHER')
        return administratorOperationSchema.parse({
          state: 'committed',
          receipt: {
            operationId,
            organizationId: orgId,
            administratorInvitationId: operationId,
            revision: 1,
          },
        })
      }
      return administratorOperationSchema.parse({
        state: 'unknown',
        expiredUnrecorded: (await provisioningAge(tx, operationId)) > 86400000,
      })
    })
  }
}
