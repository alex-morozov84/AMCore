import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { AuthErrorCode, DEFAULT_LOCALE, SystemRole } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as shared_api from '@/shared/api'

const refreshMock = vi.fn()

// Inline, English-only fixture of just the keys this hook reads -
// deliberately not the real catalogue (`messages/en.json`), which is a
// locale-scaffold-tracked source file this single-locale-agnostic unit test
// has no reason to depend on.
const messages = {
  console: {
    usersRoleChanged: 'Role updated',
  },
  errors: {
    STEP_UP_REQUIRED: 'Please confirm your password to continue.',
    STEP_UP_METHOD_UNAVAILABLE: "Password confirmation isn't available for this account.",
    INVALID_CREDENTIALS: 'Incorrect email or password.',
    BUSINESS_RULE_VIOLATION: "This action isn't allowed right now.",
    UNKNOWN_ERROR: 'Something went wrong. Please try again.',
  },
}

vi.mock('@/shared/api', async () => {
  const actual = await vi.importActual<typeof shared_api>('@/shared/api')
  return { ...actual, consoleApi: { updateUserRole: vi.fn(), stepUp: vi.fn() } }
})
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: refreshMock }),
}))
vi.mock('@/shared/ui/toast', () => ({ toast: { add: vi.fn() } }))

import { ApiRequestError, consoleApi } from '@/shared/api'
import { toast } from '@/shared/ui/toast'

import { useUserRoleChange } from './use-user-role-change'

function apiError(status: number, errorCode: string): ApiRequestError {
  return new ApiRequestError(status, {
    statusCode: status,
    message: 'diagnostic only',
    errorCode,
    timestamp: new Date().toISOString(),
    path: '/console/users/u1/role',
    method: 'PATCH',
  })
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('useUserRoleChange', () => {
  it('on a clean success, refreshes and toasts without ever opening step-up', async () => {
    vi.mocked(consoleApi.updateUserRole).mockResolvedValue({} as never)
    const { result } = renderHook(() => useUserRoleChange('u1', SystemRole.SuperAdmin), { wrapper })

    await act(() => result.current.confirmRoleChange())

    expect(result.current.stepUp).toEqual({ kind: 'closed' })
    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
  })

  it('opens the step-up dialog on STEP_UP_REQUIRED instead of toasting an error', async () => {
    vi.mocked(consoleApi.updateUserRole).mockRejectedValue(
      apiError(403, AuthErrorCode.STEP_UP_REQUIRED)
    )
    const { result } = renderHook(() => useUserRoleChange('u1', SystemRole.SuperAdmin), { wrapper })

    await act(() => result.current.confirmRoleChange())

    expect(result.current.stepUp).toEqual({ kind: 'open' })
    expect(toast.add).not.toHaveBeenCalled()
  })

  it('toasts any other failure and never opens step-up', async () => {
    vi.mocked(consoleApi.updateUserRole).mockRejectedValue(apiError(400, 'BUSINESS_RULE_VIOLATION'))
    const { result } = renderHook(() => useUserRoleChange('u1', SystemRole.SuperAdmin), { wrapper })

    await act(() => result.current.confirmRoleChange())

    expect(result.current.stepUp).toEqual({ kind: 'closed' })
    expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  it('after a successful step-up, retries the mutation exactly once and closes on success', async () => {
    vi.mocked(consoleApi.updateUserRole)
      .mockRejectedValueOnce(apiError(403, AuthErrorCode.STEP_UP_REQUIRED))
      .mockResolvedValueOnce({} as never)
    vi.mocked(consoleApi.stepUp).mockResolvedValue(undefined)
    const { result } = renderHook(() => useUserRoleChange('u1', SystemRole.SuperAdmin), { wrapper })
    await act(() => result.current.confirmRoleChange())

    await act(() => result.current.submitStepUp('correct-horse'))

    expect(consoleApi.updateUserRole).toHaveBeenCalledTimes(2)
    expect(result.current.stepUp).toEqual({ kind: 'closed' })
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('treats a second STEP_UP_REQUIRED (after a successful step-up) as terminal, not another loop', async () => {
    vi.mocked(consoleApi.updateUserRole).mockRejectedValue(
      apiError(403, AuthErrorCode.STEP_UP_REQUIRED)
    )
    vi.mocked(consoleApi.stepUp).mockResolvedValue(undefined)
    const { result } = renderHook(() => useUserRoleChange('u1', SystemRole.SuperAdmin), { wrapper })
    await act(() => result.current.confirmRoleChange())

    await act(() => result.current.submitStepUp('correct-horse'))

    expect(result.current.stepUp).toMatchObject({ kind: 'error', terminal: true })
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('marks a wrong password as a recoverable (non-terminal) step-up error', async () => {
    vi.mocked(consoleApi.updateUserRole).mockRejectedValue(
      apiError(403, AuthErrorCode.STEP_UP_REQUIRED)
    )
    vi.mocked(consoleApi.stepUp).mockRejectedValue(apiError(401, AuthErrorCode.INVALID_CREDENTIALS))
    const { result } = renderHook(() => useUserRoleChange('u1', SystemRole.SuperAdmin), { wrapper })
    await act(() => result.current.confirmRoleChange())

    await act(() => result.current.submitStepUp('wrong'))

    expect(result.current.stepUp).toMatchObject({ kind: 'error', terminal: false })
  })

  it('marks STEP_UP_METHOD_UNAVAILABLE (OAuth-only account) as terminal', async () => {
    vi.mocked(consoleApi.updateUserRole).mockRejectedValue(
      apiError(403, AuthErrorCode.STEP_UP_REQUIRED)
    )
    vi.mocked(consoleApi.stepUp).mockRejectedValue(
      apiError(403, AuthErrorCode.STEP_UP_METHOD_UNAVAILABLE)
    )
    const { result } = renderHook(() => useUserRoleChange('u1', SystemRole.SuperAdmin), { wrapper })
    await act(() => result.current.confirmRoleChange())

    await act(() => result.current.submitStepUp('anything'))

    expect(result.current.stepUp).toMatchObject({ kind: 'error', terminal: true })
  })

  it('closeStepUp resets to closed', async () => {
    vi.mocked(consoleApi.updateUserRole).mockRejectedValue(
      apiError(403, AuthErrorCode.STEP_UP_REQUIRED)
    )
    const { result } = renderHook(() => useUserRoleChange('u1', SystemRole.SuperAdmin), { wrapper })
    await act(() => result.current.confirmRoleChange())
    expect(result.current.stepUp).toEqual({ kind: 'open' })

    act(() => result.current.closeStepUp())

    await waitFor(() => expect(result.current.stepUp).toEqual({ kind: 'closed' }))
  })
})
