import { InviteErrorCode } from '@amcore/shared'

import { ContextRequestError } from './context-errors'
import { invitationOwnerKey } from './invitation-owner-store'
import { withInvitationStorage } from './invitation-storage'
import { invitationNamespace } from './invitation-surface'
import type { ProductWebContext } from './product-web-context.server'
import { createRedisVaultLock } from './session-lock-factory'
import type { VaultLock } from './session-vault.types'

import 'server-only'

const ownerLock = createRedisVaultLock('web:invitation:owner:v1')

/** Serializes the bounded owner command; record revision/attempt fences remain the authority. */
export async function withInvitationOwnerLease<T>(
  ownerHash: string,
  signal: AbortSignal,
  work: () => Promise<T>,
  lock: VaultLock = ownerLock,
  context?: ProductWebContext
): Promise<T> {
  invitationOwnerKey(ownerHash, context)
  if (context?.frontend === 'admin')
    lock = createRedisVaultLock(invitationNamespace('owner', context))
  signal.throwIfAborted()
  const token = await withInvitationStorage(() => lock.acquire(ownerHash, 25000))
  if (!token) throw new ContextRequestError(409, InviteErrorCode.INVITE_FLOW_BUSY)
  try {
    signal.throwIfAborted()
    return await work()
  } finally {
    // A failed release does not undo a committed command; token-checked release and TTL isolate successors.
    await lock.release(ownerHash, token).catch(() => undefined)
  }
}
