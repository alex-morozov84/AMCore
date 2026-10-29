import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ logout: vi.fn(), replace: vi.fn() }))
vi.mock('@/shared/api/auth-api', () => ({ authActions: () => ({ logout: mocks.logout }) }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ replace: mocks.replace }),
}))
vi.mock('@/shared/ui/route-progress-link', () => ({ RouteProgressLink: () => null }))

import { ProductAdminDenied } from './denied-page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.logout.mockResolvedValue({})
})
function show(contextSession?: string) {
  const cache = new QueryClient()
  cache.setQueryData(['private'], true)
  render(
    <NextIntlClientProvider
      locale={DEFAULT_LOCALE}
      messages={{
        productAdmin: {
          unavailableTitle: 'Page unavailable',
          unavailableHelp: 'No access',
          allOrganizations: 'Organizations',
          visitSite: 'Website',
          sharedLogout: 'Shared sign-out',
          separateLogout: 'Separate sign-out',
        },
      }}
    >
      <QueryClientProvider client={cache}>
        <ProductAdminDenied
          siteOrigin="https://shop.example.test"
          logoutLabel="Sign out"
          contextSession={contextSession}
        />
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
  return cache
}
it('uses the server-verified logout intent without fetching a profile', async () => {
  const binding = 'a'.repeat(64)
  const cache = show(binding)
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  await waitFor(() => expect(mocks.logout).toHaveBeenCalledWith(binding))
  await waitFor(() => expect(mocks.replace).toHaveBeenCalled())
  expect(cache.getQueryData(['private'])).toBeUndefined()
})
it('does not submit an unbound logout when admission is unavailable', () => {
  const cache = show()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled()
  expect(mocks.logout).not.toHaveBeenCalled()
  expect(cache.getQueryData(['private'])).toBe(true)
})
