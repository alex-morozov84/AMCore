import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readInvitationRecipientAdmission } from './admission.server'

const deps = vi.hoisted(() => ({ capture: vi.fn(), assertCurrent: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/bff/product-context-deps', () => ({ productContextDeps: () => ({}) }))
vi.mock('@/shared/api/bff/invitation-request-snapshot', () => ({
  captureInvitationRequest: deps.capture,
  assertInvitationReadCurrent: deps.assertCurrent,
}))
const binding = { flowId: 'a'.repeat(22), flowRevision: 1, sessionBinding: null }
const request = () => new Request(`https://app.example.test/en/invite/flow/${binding.flowId}`)
beforeEach(() => {
  vi.clearAllMocks()
  deps.assertCurrent.mockResolvedValue(undefined)
})

describe('personal recipient server admission', () => {
  it('projects only binding/user while vault credentials stay server-side', async () => {
    deps.capture.mockResolvedValue({
      flow: { binding, credential: 'server-only-proof' },
      ownerHash: 'owner',
      session: {
        entry: { userSnapshot: { id: 'actor' }, accessToken: 'server-only-access' },
        sessionId: 'server-only-vault',
      },
    })
    expect(await readInvitationRecipientAdmission(request(), binding.flowId)).toEqual({
      binding,
      user: { id: 'actor' },
    })
    expect(deps.assertCurrent).toHaveBeenCalledOnce()
  })
  it('does not project a retired snapshot', async () => {
    deps.capture.mockResolvedValue({ flow: { binding }, session: null })
    deps.assertCurrent.mockRejectedValue(new Error('retired'))
    await expect(readInvitationRecipientAdmission(request(), binding.flowId)).rejects.toThrow(
      'retired'
    )
  })
  it('rejects a malformed selector before accessing personal data', async () => {
    await expect(readInvitationRecipientAdmission(request(), '../other')).rejects.toThrow()
    expect(deps.capture).not.toHaveBeenCalled()
  })
})
