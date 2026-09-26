import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { consoleApi } from '@/shared/api/console-api'

import { useUserSessions } from './use-user-sessions'

vi.mock('@/shared/api/console-api', () => ({ consoleApi: { getUserSessions: vi.fn() } }))
afterEach(() => vi.clearAllMocks())

it('transmits selected locale, never reuses other-user placeholders and retains paging', async () => {
  const locale = DEFAULT_LOCALE
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const response = { data: [], total: 25, page: 1, limit: 20 }
  vi.mocked(consoleApi.getUserSessions).mockResolvedValueOnce(response)
  vi.mocked(consoleApi.getUserSessions).mockImplementation(() => new Promise(() => {}))
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={{}}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    )
  }
  const { result, rerender } = renderHook(({ id }) => useUserSessions(id), {
    initialProps: { id: 'first' },
    wrapper: Wrapper,
  })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(consoleApi.getUserSessions).toHaveBeenCalledWith('first', 1, 20, DEFAULT_LOCALE)
  act(() => result.current.setPage(2))
  expect(result.current.data).toEqual(response)
  expect(result.current.isPlaceholderData).toBe(true)
  rerender({ id: 'second' })
  expect(result.current.data).toBeUndefined()
})
