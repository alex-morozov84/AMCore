import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { authApi } from '@/shared/api'

import { userKeys, useSessions } from './user-queries'

vi.mock('@/shared/api', () => ({
  authApi: { getSessions: vi.fn(), uploadAvatar: vi.fn(), deleteAvatar: vi.fn() },
}))

describe('session locale cache isolation', () => {
  it('includes locale, so a locale switch gets a different cache entry', () => {
    expect(userKeys.sessions('en', 1, 20)).not.toEqual(userKeys.sessions('ru', 1, 20))
  })

  it('does not reuse a previous locale’s cached data as a placeholder after a locale switch', async () => {
    const enResponse = {
      data: [
        {
          id: 's-en',
          userAgent: null,
          ipAddress: null,
          location: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          current: false,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    }
    vi.mocked(authApi.getSessions).mockImplementation((_page, _limit, locale) =>
      locale === 'en' ? Promise.resolve(enResponse) : new Promise(() => {})
    )

    let locale: 'en' | 'ru' = 'en'
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function LocaleWrapper({ children }: { children: React.ReactNode }) {
      return (
        <NextIntlClientProvider locale={locale} messages={{}}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </NextIntlClientProvider>
      )
    }

    const { result, rerender } = renderHook(() => useSessions(1, 20), { wrapper: LocaleWrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data[0]?.id).toBe('s-en')

    locale = 'ru'
    rerender()

    // The ru query never resolves in this test — if the stale en data leaked
    // through as a placeholder, `data` would still show `s-en` here.
    await waitFor(() => expect(result.current.isPending).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})
