import { AppException } from '../../../common/exceptions/index.js'
import type { Prisma } from '../../../generated/prisma/client.js'

export const MEMBER_KEY_TRANSACTION = {
  isolationLevel: 'ReadCommitted',
  maxWait: 2000,
  timeout: 8000,
} as const
export async function memberKeyTimeouts(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '2000ms'`
  await tx.$executeRaw`SET LOCAL statement_timeout = '6000ms'`
}
export function memberKeyWriteFailure(error: unknown): never {
  if (error instanceof AppException) throw error
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034')
    throw new AppException('Concurrent write aborted', 409, 'MEMBER_API_KEYS_CONFLICT')
  throw new AppException('Key operation unconfirmed', 503, 'MEMBER_API_KEYS_WRITE_UNAVAILABLE')
}
