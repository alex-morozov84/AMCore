import { InfrastructureErrorCode } from '@amcore/shared'

import {
  AppException,
  ConflictException,
  ServiceUnavailableException,
} from '../../common/exceptions'
import type { PrismaService } from '../../prisma'

import type { Prisma } from '@/generated/prisma/client'

function sqlState(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = error as {
    code?: string
    meta?: { driverAdapterError?: { cause?: { originalCode?: string } } }
  }
  return value.meta?.driverAdapterError?.cause?.originalCode
}

/** Unknown acknowledgment/timeout is not a token decision and is never replayed. */
export function invitationFailure(error: unknown): never {
  if (error instanceof AppException) throw error
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (code === 'P2034' || sqlState(error) === '40P01')
    throw new ConflictException('Concurrent invitation write aborted')
  if (code === 'P2024')
    throw new ServiceUnavailableException(
      'Database pool unavailable',
      InfrastructureErrorCode.DATABASE_POOL_TIMEOUT
    )
  throw new ServiceUnavailableException(
    'Invitation write unconfirmed; inspect current state before retrying'
  )
}

export async function invitationTransaction<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2000ms'`
        return work(tx)
      },
      { isolationLevel: 'ReadCommitted', maxWait: 2000, timeout: 4000 }
    )
  } catch (error) {
    return invitationFailure(error)
  }
}
