import type { SessionsListResponse } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { ApiRequestError } from '@/shared/api/http-client'
import { server } from '@/test/msw/server'

import { useSessions } from './user-queries'

/**
 * Integration layer (FINAL PLAN §1, `ai/models-talk.md`): renders the real
 * hook against a mocked `/api/*` wire boundary instead of a mocked client
 * module, so a wrong query param or a misread error shape fails here even
 * though `user-queries.test.tsx`'s `vi.mock('@/shared/api', ...)` tests
 * (which never look at the actual request) would still pass.
 */

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('useSessions — MSW integration', () => {
  it('sends page/limit as real query string params, not just as arguments a mock ignores', async () => {
    let capturedUrl: URL | undefined

    server.use(
      http.get('/api/auth/sessions', ({ request }) => {
        capturedUrl = new URL(request.url)
        const body: SessionsListResponse = { data: [], total: 0, page: 3, limit: 5 }
        return HttpResponse.json(body)
      })
    )

    const { result } = renderHook(() => useSessions(3, 5), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(capturedUrl?.searchParams.get('page')).toBe('3')
    expect(capturedUrl?.searchParams.get('limit')).toBe('5')
    expect(result.current.data).toEqual({ data: [], total: 0, page: 3, limit: 5 })
  })

  it('surfaces a real non-2xx response as ApiRequestError, not a silently resolved value', async () => {
    server.use(
      http.get('/api/auth/sessions', () =>
        HttpResponse.json(
          { message: 'Internal error', errorCode: 'INTERNAL_ERROR' },
          { status: 500 }
        )
      )
    )

    const { result } = renderHook(() => useSessions(1, 20), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiRequestError)
  })
})
