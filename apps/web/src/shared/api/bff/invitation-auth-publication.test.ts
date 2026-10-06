import { beforeEach, describe, expect, it, vi } from 'vitest'

import { publishInvitedCredentials } from './invitation-auth-publication'
import { publishInvitationAuth } from './invitation-auth-transition'
import { invitationIssuedSessionId } from './invitation-issued-session'
import { invitationOwnerStore } from './invitation-owner-store'
import {
  discardInvitationSession,
  publishInvitationSession,
  stageInvitationSession,
} from './invitation-session-publication'

vi.mock('server-only', () => ({}))
vi.mock('./invitation-issued-session', () => ({ invitationIssuedSessionId: vi.fn() }))
vi.mock('./invitation-owner-store', () => ({ invitationOwnerStore: { get: vi.fn() } }))
vi.mock('./invitation-auth-transition', () => ({ publishInvitationAuth: vi.fn() }))
vi.mock('./invitation-session-publication', () => ({
  stageInvitationSession: vi.fn(),
  publishInvitationSession: vi.fn(),
  discardInvitationSession: vi.fn(),
}))
function input(): Parameters<typeof publishInvitedCredentials>[0] {
  // Only the capabilities read by this orchestration are supplied; pure transition/storage contracts have separate tests.
  return {
    snapshot: {
      ownerHash: 'a'.repeat(64),
      owner: { origin: 'https://app.example.test' },
      flow: { binding: { flowId: 'f'.repeat(22) }, expiresAt: Date.now() + 1800000 },
      session: null,
    },
    attempt: { id: 'i'.repeat(22), fence: 'z'.repeat(22), expiresAt: Date.now() + 60000 },
    credentials: {
      data: { user: { id: 'user-example' }, accessToken: '<test-access>' },
      refreshToken: '<test-refresh>',
    },
    signal: new AbortController().signal,
  } as Parameters<typeof publishInvitedCredentials>[0]
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(invitationIssuedSessionId).mockReturnValue('backend-example')
  vi.mocked(stageInvitationSession).mockResolvedValue('s'.repeat(43))
  vi.mocked(invitationOwnerStore.get).mockResolvedValue({ version: 4 } as NonNullable<
    Awaited<ReturnType<typeof invitationOwnerStore.get>>
  >)
  vi.mocked(publishInvitationAuth).mockReturnValue({
    flows: [
      { binding: { flowId: 'f'.repeat(22), flowRevision: 3, sessionBinding: 'b'.repeat(64) } },
    ],
  } as ReturnType<typeof publishInvitationAuth>)
  vi.mocked(publishInvitationSession).mockResolvedValue(true)
})
describe('server-only credential publication orchestration', () => {
  it('returns a cookie ID only after the atomic journal/vault publication succeeds', async () => {
    const result = await publishInvitedCredentials(input())
    expect(result.sessionId).toBe('s'.repeat(43))
    expect(result.binding.flowRevision).toBe(3)
    expect(publishInvitationSession).toHaveBeenCalledWith(
      'a'.repeat(64),
      4,
      expect.anything(),
      's'.repeat(43),
      undefined
    )
    expect(discardInvitationSession).not.toHaveBeenCalled()
    expect(result).not.toHaveProperty('accessToken')
    expect(result).not.toHaveProperty('refreshToken')
  })
  it('bounds a six-minute provider reservation to a sixty-second local publication window', async () => {
    const pending = input()
    pending.attempt.expiresAt = Date.now() + 360000
    const before = Date.now()
    await publishInvitedCredentials(pending)
    const staged = vi.mocked(stageInvitationSession).mock.calls[0]![0]
    expect(staged.deadline).toBeGreaterThanOrEqual(before + 60000)
    expect(staged.deadline).toBeLessThanOrEqual(Date.now() + 60000)
    expect(staged.deadline).toBeLessThan(pending.attempt.expiresAt)
  })
  it('discards only staged credentials on a stale owner CAS and returns no cookie', async () => {
    vi.mocked(publishInvitationSession).mockResolvedValue(false)
    await expect(publishInvitedCredentials(input())).rejects.toThrow()
    expect(discardInvitationSession).toHaveBeenCalledWith('a'.repeat(64), 's'.repeat(43))
  })
  it('does not stage credentials without the API refresh cookie or after cancellation', async () => {
    const missing = input()
    missing.credentials.refreshToken = null
    await expect(publishInvitedCredentials(missing)).rejects.toThrow()
    const canceled = input()
    canceled.signal = AbortSignal.abort()
    await expect(publishInvitedCredentials(canceled)).rejects.toThrow()
    expect(stageInvitationSession).not.toHaveBeenCalled()
  })
})
