import { ContextRequestError } from './context-errors'
import { SessionVaultUnavailableError } from './errors'

import 'server-only'

/** Redis failures are transient and must not retain exceptions containing credential records. */
export async function withInvitationStorage<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ContextRequestError || error instanceof SessionVaultUnavailableError)
      throw error
    throw new SessionVaultUnavailableError(undefined)
  }
}
