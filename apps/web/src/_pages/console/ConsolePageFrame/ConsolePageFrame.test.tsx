import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/client-message-boundary', () => ({
  ClientMessages: ({ children }: { children: unknown }) => children,
}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/shared/api/console/access-token', () => ({
  getConsoleAwareUser: vi.fn(),
  getConsoleLogoutIntent: vi.fn().mockResolvedValue('a'.repeat(64)),
}))
vi.mock('@/shared/lib/require-super-admin', () => ({ requireSuperAdmin: vi.fn() }))
vi.mock('@/shared/ui/primary-unavailable-fallback', () => ({
  PrimaryUnavailableFallback: () => <div>Unavailable</div>,
}))
vi.mock('@/widgets/console-shell', () => ({
  ConsoleShell: vi.fn(({ children }: { children: unknown }) => children),
}))

import { cookies } from 'next/headers'

import { getConsoleAwareUser } from '@/shared/api/console/access-token'
import { requireSuperAdmin } from '@/shared/lib/require-super-admin'
import { ConsoleShell } from '@/widgets/console-shell'

import { ConsolePageFrame } from './ConsolePageFrame'

describe('ConsolePageFrame', () => {
  it('does not resolve identity when admission is temporarily unavailable', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue('unavailable')

    const frame = await ConsolePageFrame({
      children: <div>Console content</div>,
      fallback: <div>Loading</div>,
    })

    // Only the fallback is rendered: the page content, which carries the configured external tool
    // addresses, never reaches a visitor whose admission could not be verified.
    render(frame)
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Console content')).not.toBeInTheDocument()
    expect(getConsoleAwareUser).not.toHaveBeenCalled()
    expect(cookies).not.toHaveBeenCalled()
    expect(ConsoleShell).not.toHaveBeenCalled()
  })

  it('restores the sidebar preference only after admission succeeds', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue('admitted')
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: 'false' }) } as never)

    const frame = await ConsolePageFrame({
      children: <div>Console content</div>,
      fallback: <div>Loading</div>,
    })

    expect(frame.props.namespaces).toEqual(['accountMfa'])
    expect(frame.props.children.props.defaultSidebarOpen).toBe(false)
  })
})
