import { AppException } from '../../../common/exceptions/index.js'
import type { Prisma } from '../../../generated/prisma/client.js'
import type { PrismaService } from '../../../prisma/index.js'
import { provisioningError } from '../provisioning/provisioning-error.js'
import { provisioningTransaction } from '../provisioning/provisioning-transaction.js'

/** Reuse established transaction limits; expose command-specific uncertain outcomes. */
export async function administratorTransaction<T>(
  db: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  try {
    return await provisioningTransaction(db, work)
  } catch (error) {
    if (error instanceof AppException) {
      const mapped = {
        PROVISIONING_UNCONFIRMED: 'ADMIN_OPERATION_UNCONFIRMED',
        INVITE_OPERATION_CONFLICT: 'ADMIN_INTENT_MISMATCH',
        INVITE_OPERATION_EXPIRED: 'ADMIN_OPERATION_EXPIRED',
      }[error.errorCode ?? '']
      if (mapped) throw provisioningError(mapped, error.getStatus())
    }
    throw error
  }
}
