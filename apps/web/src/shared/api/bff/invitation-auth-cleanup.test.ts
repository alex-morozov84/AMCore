import { AuthErrorCode } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { abortInvitationAuth } from './invitation-auth-cleanup'
import type * as InvitationUpstream from './invitation-upstream'
import { invitationBackend, InvitationBackendError } from './invitation-upstream'

vi.mock('server-only', () => ({}))
vi.mock('./invitation-upstream', async (importOriginal) => ({
  ...(await importOriginal<typeof InvitationUpstream>()),
  invitationBackend: vi.fn(),
}))
const proof = { attemptId: 'a'.repeat(22), cleanupKey: 'b'.repeat(43) }
beforeEach(() => vi.resetAllMocks())
describe('durable invitation authentication cleanup', () => {
  it('uses exact attempt proof and an independent abort deadline', async () => {
    vi.mocked(invitationBackend).mockResolvedValue({
      data: { status: 'aborted' },
      refreshToken: null,
    })
    expect(await abortInvitationAuth(new Headers(), proof)).toBe('aborted')
    expect(invitationBackend).toHaveBeenCalledWith(
      `/auth/invites/auth-handoffs/${proof.attemptId}/abort`,
      expect.anything(),
      expect.objectContaining({ handoff: proof, method: 'POST', signal: expect.any(AbortSignal) })
    )
  })
  it('does not revoke or release an already confirmed session', async () => {
    vi.mocked(invitationBackend).mockRejectedValue(
      new InvitationBackendError(409, true, AuthErrorCode.AUTH_HANDOFF_CONFIRMED)
    )
    expect(await abortInvitationAuth(new Headers(), proof)).toBe('confirmed')
  })
  it('does not treat an unavailable/invalid cleanup proof as evidence of revocation', async () => {
    for (const error of [
      new InvitationBackendError(503, false),
      new InvitationBackendError(401, true, AuthErrorCode.AUTH_HANDOFF_INVALID),
    ]) {
      vi.mocked(invitationBackend).mockRejectedValue(error)
      expect(await abortInvitationAuth(new Headers(), proof)).toBe('unresolved')
    }
  })
})
