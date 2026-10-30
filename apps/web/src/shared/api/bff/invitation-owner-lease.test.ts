// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { ContextRequestError } from './context-errors'
import { SessionVaultUnavailableError } from './errors'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import type { VaultLock } from './session-vault.types'

vi.mock('server-only', () => ({}))

// The invitation owner lease uses the shared lock factory, which now runs on the supervised vault
// connection. These cases pin its contract against that change: busy, outage and token release.
const HASH = 'a'.repeat(64)
const lockWith = (overrides: Partial<VaultLock> = {}): VaultLock => ({
  acquire: vi.fn(async () => 'token-1'),
  renew: vi.fn(async () => true),
  release: vi.fn(async () => undefined),
  ...overrides,
})
const signal = () => new AbortController().signal

describe('withInvitationOwnerLease', () => {
  it('runs the command under the lease and releases its own token', async () => {
    const lock = lockWith()
    await expect(withInvitationOwnerLease(HASH, signal(), async () => 'done', lock)).resolves.toBe(
      'done'
    )
    expect(lock.acquire).toHaveBeenCalledWith(HASH, 25_000)
    expect(lock.release).toHaveBeenCalledWith(HASH, 'token-1')
  })

  it('answers busy when the lease is held, without running the command', async () => {
    const lock = lockWith({ acquire: vi.fn(async () => null) })
    const work = vi.fn()
    await expect(withInvitationOwnerLease(HASH, signal(), work, lock)).rejects.toBeInstanceOf(
      ContextRequestError
    )
    expect(work).not.toHaveBeenCalled()
    expect(lock.release).not.toHaveBeenCalled()
  })

  it('treats an unavailable vault connection as a temporary failure, not as busy', async () => {
    const lock = lockWith({
      acquire: vi.fn(async () => {
        throw new SessionVaultUnavailableError(new Error('down'))
      }),
    })
    const work = vi.fn()
    await expect(withInvitationOwnerLease(HASH, signal(), work, lock)).rejects.toBeInstanceOf(
      SessionVaultUnavailableError
    )
    expect(work).not.toHaveBeenCalled()
  })

  it('wraps an unexpected acquire failure without leaking its detail', async () => {
    const lock = lockWith({
      acquire: vi.fn(async () => {
        throw new Error('record with credentials')
      }),
    })
    const error = await withInvitationOwnerLease(HASH, signal(), vi.fn(), lock).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(SessionVaultUnavailableError)
    expect((error as Error).cause).toBeUndefined()
  })

  it('releases after a failing command and a failed release never replaces the outcome', async () => {
    const lock = lockWith({
      release: vi.fn(async () => {
        throw new Error('release lost')
      }),
    })
    await expect(
      withInvitationOwnerLease(
        HASH,
        signal(),
        async () => {
          throw new Error('command failed')
        },
        lock
      )
    ).rejects.toThrow('command failed')
    expect(lock.release).toHaveBeenCalledWith(HASH, 'token-1')
  })
})
