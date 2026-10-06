import type { PropsWithChildren } from 'react'
import { AuthErrorCode } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { useRecipientAuthentication } from './use-recipient-authentication'

const { context, createAdapters } = vi.hoisted(() => ({ context: vi.fn(), createAdapters: vi.fn((_input: unknown) => ({})) }))
vi.mock('@/entities/invitation-flow', () => ({ invitationFlowClient: { context } }))
vi.mock('./credential-adapters', () => ({ createInvitationCredentialAdapters: createAdapters }))
afterEach(() => vi.clearAllMocks())
const binding = { flowId: 'a'.repeat(22), flowRevision: 1, sessionBinding: null }
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useRecipientAuthentication(binding, null), { wrapper })
}

describe('recipient pending authentication recovery', () => {
  it.each([AuthErrorCode.INVALID_CREDENTIALS, AuthErrorCode.RATE_LIMIT_EXCEEDED])(
    'synchronizes known rejection %s without replaying credentials', async (code) => {
    const { result } = setup()
    const callbacks = createAdapters.mock.calls.at(-1)?.[0] as unknown as {
      onStart(): void; onFailure(error: unknown): Promise<void>
    }
    const failure = new ApiRequestError(code === AuthErrorCode.RATE_LIMIT_EXCEEDED ? 429 : 401, { errorCode: code } as never)
    context.mockResolvedValueOnce({ binding: { ...binding, flowRevision: 3 }, data: { email: 'invited@example.test' } })
    act(() => callbacks.onStart())
    await act(() => callbacks.onFailure(failure))
    expect(result.current.phase).toBe('active')
    expect(result.current.binding.flowRevision).toBe(3)
    expect(result.current.error).toBe(failure)
    expect(context).toHaveBeenCalledOnce()
  })

  it.each(['INVITE_INVALID_OR_EXPIRED', 'INVITE_FLOW_CHANGED'])(
    'requires reopening after %s',
    async (code) => {
      context.mockRejectedValueOnce(
        new ApiRequestError(409, {
          errorCode: code,
          message: 'test failure',
          timestamp: new Date(0).toISOString(),
          path: '/test',
          method: 'GET',
          statusCode: 409,
        })
      )
      const { result } = setup()
      act(() => result.current.observePending(binding, 'authenticating'))
      await act(() => result.current.recover())
      await waitFor(() =>
        expect(result.current.phase).toBe(code === 'INVITE_FLOW_CHANGED' ? 'retired' : 'unusable')
      )
      expect(result.current.user).toBeNull()
      expect(result.current.handoff).toBeNull()
      expect(context).toHaveBeenCalledOnce()
    }
  )

  it('preserves the pending operation after a transport failure', async () => {
    context.mockRejectedValueOnce(new TypeError('connection interrupted'))
    const { result } = setup()
    act(() => result.current.observePending(binding, 'authenticating'))
    await act(() => result.current.recover())
    expect(result.current.phase).toBe('authenticating')
    expect(result.current.error).toBeInstanceOf(TypeError)
  })
})
