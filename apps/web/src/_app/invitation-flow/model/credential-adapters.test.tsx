import type { UserResponse } from '@amcore/shared'
import { DEFAULT_LOCALE, type LoginInput } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLogin } from '@/features/auth-login'
import { useRegister } from '@/features/auth-register'
import type { CredentialFormAdapter } from '@/shared/lib/credential-form-adapter'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('@/entities/user', () => ({ userKeys: { me: () => ['user', 'me'] } }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ push }),
}))
vi.mock('@/shared/lib/use-field-error-translator', () => ({
  useFieldErrorTranslator: () => () => 'localized',
}))
vi.mock('@/shared/ui/route-progress-link', () => ({ RouteProgressLink: () => null }))
const response = { user: { id: 'example-user', locale: DEFAULT_LOCALE } as UserResponse }
const input = { email: 'invited@example.test', password: '<test-password>' }
beforeEach(() => vi.clearAllMocks())

for (const [name, useCredential] of [
  ['login', useLogin],
  ['register', useRegister],
] as const) {
  describe(`invited ${name} adapter`, () => {
    function setup(adapter: CredentialFormAdapter<LoginInput>) {
      const queryClient = new QueryClient()
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      )
      return { queryClient, ...renderHook(() => useCredential(undefined, adapter), { wrapper }) }
    }

    it('waits for the confirmed handoff and uses the application continuation', async () => {
      let complete!: (value: typeof response) => void
      const adapter = {
        submit: vi.fn(
          () =>
            new Promise<typeof response>((resolve) => {
              complete = resolve
            })
        ),
        isCurrent: () => true,
        onSuccess: vi.fn(),
      }
      const { result, queryClient } = setup(adapter)
      act(() => result.current.mutate(input))
      await waitFor(() => expect(adapter.submit).toHaveBeenCalledOnce())
      expect(queryClient.getQueryData(['user', 'me'])).toBeUndefined()
      expect(push).not.toHaveBeenCalled()
      await act(async () => complete(response))
      await waitFor(() => expect(adapter.onSuccess).toHaveBeenCalledWith(response))
      expect(queryClient.getQueryData(['user', 'me'])).toEqual(response)
      expect(push).not.toHaveBeenCalled()
    })

    it('does not publish a late handoff from a retired flow', async () => {
      let current = true
      let complete!: (value: typeof response) => void
      const adapter = {
        submit: vi.fn(
          () =>
            new Promise<typeof response>((resolve) => {
              complete = resolve
            })
        ),
        isCurrent: () => current,
        onSuccess: vi.fn(),
      }
      const { result, queryClient } = setup(adapter)
      act(() => result.current.mutate(input))
      await waitFor(() => expect(adapter.submit).toHaveBeenCalledOnce())
      current = false
      await act(async () => complete(response))
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(queryClient.getQueryData(['user', 'me'])).toBeUndefined()
      expect(adapter.onSuccess).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
    })
  })
}
