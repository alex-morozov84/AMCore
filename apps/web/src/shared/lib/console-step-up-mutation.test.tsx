import type { ReactNode } from 'react'
import { AuthErrorCode } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api', () => ({
  getErrorCode: (error: { code?: string }) => error.code,
  useApiError: () => () => ({ message: 'Safe error' }),
}))
vi.mock('@/shared/api/console-api', () => ({ consoleApi: { stepUp: vi.fn() } }))
vi.mock('@/shared/ui/toast', () => ({ toast: { add: vi.fn() } }))
import { consoleApi } from '@/shared/api/console-api'

import { useStepUpMutation } from './console-step-up-mutation'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  )
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const stale = { code: AuthErrorCode.STEP_UP_REQUIRED }
beforeEach(() => vi.resetAllMocks())

describe('cancelled privileged continuation', () => {
  it('does not resume a send when a password response arrives after closing', async () => {
    const password = deferred()
    vi.mocked(consoleApi.stepUp).mockReturnValue(
      password.promise as ReturnType<typeof consoleApi.stepUp>
    )
    const mutationFn = vi.fn().mockRejectedValueOnce(stale).mockResolvedValue('sent')
    const onSuccess = vi.fn()
    const view = renderHook(() => useStepUpMutation({ mutationFn, onSuccess }), { wrapper })
    await act(async () => {
      await view.result.current.confirm()
    })
    expect(view.result.current.stepUp.kind).toBe('open')
    let pending!: Promise<void>
    act(() => {
      pending = view.result.current.submitStepUp('<fake-password>')
    })
    await waitFor(() => expect(consoleApi.stepUp).toHaveBeenCalledTimes(1))
    act(() => view.result.current.closeStepUp())
    await act(async () => {
      password.resolve()
      await pending
    })
    expect(mutationFn).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(view.result.current.stepUp.kind).toBe('closed')
  })

  it('does not reopen a closed password dialog after a late freshness refusal', async () => {
    const request = deferred()
    const mutationFn = vi.fn(async () => {
      await request.promise
      throw stale
    })
    const view = renderHook(() => useStepUpMutation({ mutationFn, onSuccess: vi.fn() }), {
      wrapper,
    })
    let pending!: Promise<void>
    act(() => {
      pending = view.result.current.confirm()
    })
    await waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(1))
    act(() => view.result.current.closeStepUp())
    await act(async () => {
      request.resolve()
      await pending
    })
    expect(view.result.current.stepUp.kind).toBe('closed')
  })
})
