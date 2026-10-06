import type { InvitationFlowAuthResponse, UserResponse } from '@amcore/shared'
import { describe, expect, it, vi } from 'vitest'

import { createInvitationCredentialAdapters } from './credential-adapters'

vi.mock('client-only', () => ({}))
const binding = { flowId: 'f'.repeat(22), flowRevision: 1, sessionBinding: null }
const response: InvitationFlowAuthResponse = {
  binding: { ...binding, flowRevision: 3, sessionBinding: 'a'.repeat(64) },
  data: { user: { id: 'example-user' } as UserResponse }, handoff: { attemptId: 'b'.repeat(22) },
}
const credentials = { email: 'invited@example.test', password: '<test-password>' }
function setup() {
  const continuation = { binding, isCurrent: () => true, onHandoff: vi.fn(), onConfirmed: vi.fn(), onFailure: vi.fn() }
  const transport = {
    login: vi.fn().mockResolvedValue(response), register: vi.fn().mockResolvedValue(response),
    acknowledge: vi.fn().mockResolvedValue(response),
  }
  return { continuation, transport, adapters: createInvitationCredentialAdapters(continuation, transport) }
}
describe('invitation credential handoff adapter', () => {
  it('resolves credentials only after a separate ACK, with no automatic joining', async () => {
    const state = setup()
    let confirm!: (value: InvitationFlowAuthResponse) => void
    state.transport.acknowledge.mockImplementation(() => new Promise(resolve => { confirm = resolve }))
    const pending = state.adapters.login.submit(credentials)
    await vi.waitFor(() => expect(state.transport.acknowledge).toHaveBeenCalledOnce())
    expect(state.continuation.onHandoff).toHaveBeenCalledWith(response.binding, response.handoff.attemptId)
    expect(state.continuation.onConfirmed).not.toHaveBeenCalled()
    confirm(response)
    const result = await pending
    expect(result).toEqual(response.data)
    state.adapters.login.onSuccess(result)
    expect(state.continuation.onConfirmed).toHaveBeenCalledWith(response.binding, response.data.user)
  })

  it('never resubmits authentication when the ACK outcome is unknown', async () => {
    const state = setup()
    const failure = new Error('Response lost')
    state.transport.acknowledge.mockRejectedValue(failure)
    await expect(state.adapters.login.submit(credentials)).rejects.toBe(failure)
    await expect(state.adapters.login.submit(credentials)).rejects.toMatchObject({ code: 'AUTH_CONTINUATION_CHANGED' })
    expect(state.transport.login).toHaveBeenCalledOnce()
    expect(state.transport.acknowledge).toHaveBeenCalledOnce()
    expect(state.continuation.onFailure).toHaveBeenCalledWith(failure)
  })

  it('uses only continuation authority to select the invited registration email', async () => {
    const state = setup()
    await state.adapters.register.submit({ ...credentials, email: 'different@example.test', name: 'Example' })
    expect(state.transport.register).toHaveBeenCalledWith({ binding, name: 'Example',
      password: credentials.password, locale: undefined }, expect.any(AbortSignal))
    expect(state.transport.login).not.toHaveBeenCalled()
  })

  it('rejects another-flow results and never ACKs after local retirement', async () => {
    for (const retired of [false, true]) {
      const state = setup()
      state.transport.login.mockImplementation(async () => {
        if (retired) state.continuation.isCurrent = () => false
        return retired ? response : { ...response, binding: { ...response.binding, flowId: 'x'.repeat(22) } }
      })
      await expect(state.adapters.login.submit(credentials)).rejects.toMatchObject({ code: 'AUTH_CONTINUATION_CHANGED' })
      expect(state.transport.acknowledge).not.toHaveBeenCalled()
      expect(state.continuation.onConfirmed).not.toHaveBeenCalled()
    }
  })
})
