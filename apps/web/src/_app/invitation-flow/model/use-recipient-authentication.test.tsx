import type { PropsWithChildren } from 'react'
import { AuthErrorCode } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'

import { useRecipientAuthentication } from './use-recipient-authentication'

const { context, createAdapters } = vi.hoisted(() => ({
  context: vi.fn(),
  createAdapters: vi.fn((_input: unknown) => ({})),
}))
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
    'synchronizes known rejection %s without replaying credentials',
    async (code) => {
      const { result } = setup()
      const callbacks = createAdapters.mock.calls.at(-1)?.[0] as unknown as {
        onStart(): void
        onFailure(error: unknown): Promise<void>
      }
      const failure = new ApiRequestError(code === AuthErrorCode.RATE_LIMIT_EXCEEDED ? 429 : 401, {
        errorCode: code,
      } as never)
      context.mockResolvedValueOnce({
        binding: { ...binding, flowRevision: 3 },
        data: { email: 'invited@example.test' },
      })
      act(() => callbacks.onStart())
      await act(() => callbacks.onFailure(failure))
      expect(result.current.phase).toBe('active')
      expect(result.current.binding.flowRevision).toBe(3)
      expect(result.current.error).toBe(failure)
      expect(context).toHaveBeenCalledOnce()
    }
  )

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

describe('confirmed registration without a published session', () => {
  const created = new ApiRequestError(503, {
    errorCode: AuthErrorCode.REGISTRATION_SIGN_IN_REQUIRED,
  } as never)
  function started() {
    const hook = setup()
    const callbacks = createAdapters.mock.calls.at(-1)?.[0] as unknown as {
      onStart(): void
      onFailure(error: unknown): Promise<void>
    }
    act(() => callbacks.onStart())
    return { ...hook, callbacks }
  }

  it('keeps the notice, reads the context without replaying credentials and enables sign-in', async () => {
    const { result, callbacks } = started()
    context.mockResolvedValueOnce({
      binding: { ...binding, flowRevision: 3 },
      data: { email: 'invited@example.test' },
    })
    await act(() => callbacks.onFailure(created))
    expect(context).toHaveBeenCalledOnce()
    expect(result.current.phase).toBe('active')
    expect(result.current.binding.flowRevision).toBe(3)
    expect(result.current.created).toBe(true)
    expect(result.current.error).toBeUndefined()
  })

  it('keeps the notice and the existing recovery screen while the context is still pending', async () => {
    const { result, callbacks } = started()
    context.mockResolvedValueOnce({
      binding: { ...binding, flowRevision: 2 },
      state: 'authenticating',
    })
    await act(() => callbacks.onFailure(created))
    expect(result.current.phase).toBe('authenticating')
    expect(result.current.created).toBe(true)
    expect(result.current.createdFailure).toBe(created)
  })

  it.each([
    ['INVITE_FLOW_CHANGED', 'retired'],
    ['INVITE_INVALID_OR_EXPIRED', 'unusable'],
  ])('falls back to re-entry guidance after %s', async (code, phase) => {
    const { result, callbacks } = started()
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
    await act(() => callbacks.onFailure(created))
    expect(result.current.phase).toBe(phase)
    expect(result.current.created).toBe(false)
  })

  it('does not enable sign-in and keeps the notice when the context cannot be read', async () => {
    const { result, callbacks } = started()
    context.mockRejectedValueOnce(new TypeError('connection interrupted'))
    await act(() => callbacks.onFailure(created))
    expect(result.current.phase).toBe('authenticating')
    expect(result.current.created).toBe(true)
    expect(result.current.createdFailure).toBe(created)
    expect(result.current.error).toBeInstanceOf(TypeError)
  })

  it('does not trust a context for a different flow', async () => {
    const { result, callbacks } = started()
    context.mockResolvedValueOnce({
      binding: { ...binding, flowId: 'b'.repeat(22) },
      data: { email: 'invited@example.test' },
    })
    await act(() => callbacks.onFailure(created))
    expect(result.current.phase).toBe('authenticating')
    expect(result.current.binding.flowId).toBe(binding.flowId)
    expect(result.current.created).toBe(true)
  })

  it('keeps the notice when a later sign-in attempt is rejected', async () => {
    const { result, callbacks } = started()
    context.mockResolvedValueOnce({
      binding: { ...binding, flowRevision: 3 },
      data: { email: 'invited@example.test' },
    })
    await act(() => callbacks.onFailure(created))
    const rejected = new ApiRequestError(401, {
      errorCode: AuthErrorCode.INVALID_CREDENTIALS,
    } as never)
    context.mockResolvedValueOnce({
      binding: { ...binding, flowRevision: 5 },
      data: { email: 'invited@example.test' },
    })
    const latest = createAdapters.mock.calls.at(-1)?.[0] as unknown as {
      onStart(): void
      onFailure(error: unknown): Promise<void>
    }
    act(() => latest.onStart())
    await act(() => latest.onFailure(rejected))
    expect(result.current.created).toBe(true)
    expect(result.current.error).toBe(rejected)
  })

  it('clears the notice when the person is retired from the flow', async () => {
    const { result, callbacks } = started()
    context.mockResolvedValueOnce({
      binding: { ...binding, flowRevision: 3 },
      data: { email: 'invited@example.test' },
    })
    await act(() => callbacks.onFailure(created))
    act(() => result.current.retire())
    expect(result.current.created).toBe(false)
  })
})
