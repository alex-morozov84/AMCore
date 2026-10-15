import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { userKeys } from '@/entities/user'
import { authApi } from '@/shared/api'

import { AccountMenu } from './AccountMenu'

const push = vi.fn()
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => {
    const t = (key: string) => `${namespace}.${key}`
    t.has = () => true
    return t
  },
}))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ push }),
}))
vi.mock('@/shared/api', () => ({
  authApi: { getMe: vi.fn(), logout: vi.fn(), uploadAvatar: vi.fn(), deleteAvatar: vi.fn() },
}))

function renderMenu(user: Record<string, unknown> | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(userKeys.me(), { user })
  render(
    <QueryClientProvider client={queryClient}>
      <AccountMenu />
    </QueryClientProvider>
  )
}

const ada = { id: 'u1', email: 'ada@example.test', name: 'Ada Lovelace', avatarUrl: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authApi.getMe).mockResolvedValue({ user: null } as never)
})

describe('AccountMenu', () => {
  it('renders nothing without a signed-in user', () => {
    renderMenu(null)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows a placeholder of the same footprint while the user loads', () => {
    vi.mocked(authApi.getMe).mockReturnValue(new Promise(() => {}) as never)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <AccountMenu />
      </QueryClientProvider>
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2)
  })

  it('shows the name on the trigger and both identities in the menu', async () => {
    renderMenu(ada)
    const trigger = screen.getByRole('button', { name: 'account.menuLabel' })
    expect(trigger).toHaveTextContent('Ada Lovelace')
    await userEvent.click(trigger)
    expect(await screen.findByText('ada@example.test')).toBeInTheDocument()
  })

  it('falls back to the email when the user has no name', async () => {
    renderMenu({ ...ada, name: null })
    expect(screen.getByRole('button', { name: 'account.menuLabel' })).toHaveTextContent(
      'ada@example.test'
    )
  })

  it('opens the profile dialog from the Profile item', async () => {
    renderMenu(ada)
    await userEvent.click(screen.getByRole('button', { name: 'account.menuLabel' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /account\.profile/ }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('account.profileTitle')
  })

  it('logs out from the menu and goes to the login page', async () => {
    vi.mocked(authApi.logout).mockResolvedValue(undefined as never)
    renderMenu(ada)
    await userEvent.click(screen.getByRole('button', { name: 'account.menuLabel' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /auth\.logout/ }))
    await waitFor(() => expect(authApi.logout).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
  })
})
