import { AppException } from '../../../common/exceptions/index.js'
import type { Prisma } from '../../../generated/prisma/client.js'
import { acquireXactLock } from '../../../prisma/advisory-lock.js'
import type { PrismaService } from '../../../prisma/index.js'
import {
  databaseCode,
  databaseSqlState,
  isOrganizationSlugConflict,
} from '../establishment-error.js'
import { establishmentTransaction } from '../establishment-transaction.js'
import { lockInvitationUser } from '../invitation-locks.js'
import { admitSetupOperator, type SetupOperator } from '../organization-setup-admission.js'

import { provisioningError } from './provisioning-error.js'

export async function lockProvisioningOperator(
  tx: Prisma.TransactionClient,
  operator: SetupOperator,
  creating = false
): Promise<void> {
  if (operator.principal.organizationId) throw provisioningError('FORBIDDEN', 403)
  await acquireXactLock(tx, 'system-role:SUPER_ADMIN')
  if (creating) await tx.$executeRaw`LOCK TABLE core.organizations IN ROW EXCLUSIVE MODE`
  await lockInvitationUser(tx, operator.principal.sub)
  await admitSetupOperator(tx, operator, true)
}
export async function provisioningTransaction<T>(
  db: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  try {
    return await establishmentTransaction(db, work)
  } catch (error) {
    if (error instanceof AppException) throw error
    if (isOrganizationSlugConflict(error)) throw provisioningError('PROVISIONING_SLUG_TAKEN')
    if (
      databaseCode(error) === 'P2034' ||
      ['40P01', '55P03'].includes(databaseSqlState(error) ?? '')
    )
      throw provisioningError('PROVISIONING_BUSY', 503)
    throw provisioningError('PROVISIONING_UNCONFIRMED', 503)
  }
}
