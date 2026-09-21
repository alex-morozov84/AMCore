import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/shared/api/console/access-token', () => ({ getConsoleAwareUser: vi.fn() }))
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

    await ConsolePageFrame({ children: <div>Console content</div>, fallback: <div>Loading</div> })

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

    expect(frame.props.defaultSidebarOpen).toBe(false)
  })
})
