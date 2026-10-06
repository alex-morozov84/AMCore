import { beforeEach, describe, expect, it, vi } from 'vitest'

import { contextSessionBinding } from './context-session'
import {
  assertOrdinaryOAuthAllowed,
  cancelInvitedOAuthForOrdinaryStart,
  retireFlowsForOrdinaryAuth,
} from './invitation-auth-lifecycle'
import { newInvitationOwner } from './invitation-flow-authority'
import { invitationOwnerStore } from './invitation-owner-store'
import { invitationRequestAuthority } from './invitation-request-authority'
import type { VaultEntry } from './session-vault.types'

vi.mock('server-only', () => ({}))
vi.mock('./invitation-owner-store', () => ({
  invitationOwnerStore: { get: vi.fn(), compareAndSet: vi.fn() },
}))
vi.mock('./invitation-request-authority', () => ({ invitationRequestAuthority: vi.fn() }))
vi.mock('./invitation-owner-lease', () => ({
  withInvitationOwnerLease: (_hash: string, _signal: AbortSignal, work: () => unknown) => work(),
}))
const request = (proof = true) =>
  new Request('https://app.example.test/api/auth/login', {
    headers: proof ? { cookie: `__Host-amcore_invite_browser=${'p'.repeat(43)}` } : {},
  })
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(invitationRequestAuthority).mockReturnValue({
    ownerHash: 'a'.repeat(64),
    policy: {
      origin: 'https://app.example.test',
      name: '__Host-amcore_invite_browser',
      options: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
    },
  })
  vi.mocked(invitationOwnerStore.get).mockResolvedValue(
    newInvitationOwner('https://app.example.test', null, Date.now())
  )
  vi.mocked(invitationOwnerStore.compareAndSet).mockResolvedValue(true)
})

describe('ordinary authentication invitation lifecycle', () => {
  it('does not require invitation configuration or storage without a browser proof', async () => {
    await assertOrdinaryOAuthAllowed(request(false))
    await retireFlowsForOrdinaryAuth(request(false), null)
    await cancelInvitedOAuthForOrdinaryStart(request(false))
    expect(invitationRequestAuthority).not.toHaveBeenCalled()
    expect(invitationOwnerStore.get).not.toHaveBeenCalled()
  })

  it('rejects an uncorrelated OAuth result while the owner has a pending attempt', async () => {
    vi.mocked(invitationOwnerStore.get).mockResolvedValue({
      ...newInvitationOwner('https://app.example.test', null, Date.now()),
      pendingOAuthAttemptId: 'i'.repeat(22),
    })
    await expect(assertOrdinaryOAuthAllowed(request())).rejects.toThrow()
    expect(invitationOwnerStore.compareAndSet).not.toHaveBeenCalled()
  })

  it('retires the epoch and binds it to the newly published opaque cookie and actor', async () => {
    await retireFlowsForOrdinaryAuth(request(), {
      sessionId: 's'.repeat(43),
      actorId: 'example-user',
    })
    const next = vi.mocked(invitationOwnerStore.compareAndSet).mock.calls[0]![2]
    expect(next.epoch).toBe(1)
    expect(next.pendingOAuthAttemptId).toBeNull()
    expect(next.sessionBinding).toBe(
      contextSessionBinding('s'.repeat(43), {
        userSnapshot: { id: 'example-user' },
      } as VaultEntry)
    )
  })

  it('does not publish a replacement authority after a failed CAS', async () => {
    vi.mocked(invitationOwnerStore.compareAndSet).mockResolvedValue(false)
    await expect(retireFlowsForOrdinaryAuth(request(), null)).rejects.toThrow()
  })
  it('rejects a pending invited attempt discovered inside the ordinary OAuth publication lease', async () => {
    vi.mocked(invitationOwnerStore.get).mockResolvedValue({
      ...newInvitationOwner('https://app.example.test', null, Date.now()),
      pendingOAuthAttemptId: 'i'.repeat(22),
    })
    await expect(
      retireFlowsForOrdinaryAuth(
        request(),
        { sessionId: 's'.repeat(43), actorId: 'example-user' },
        { rejectPendingHandoff: true }
      )
    ).rejects.toThrow()
    expect(invitationOwnerStore.compareAndSet).not.toHaveBeenCalled()
  })

  it('normal OAuth initiation leaves an owner with no pending invitation unchanged', async () => {
    await cancelInvitedOAuthForOrdinaryStart(request())
    expect(invitationOwnerStore.compareAndSet).not.toHaveBeenCalled()
  })
})
