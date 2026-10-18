import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type OrganizationAccessController,
  useMemberApiKeys,
} from '@/entities/organization-context'

import { MemberApiKeysHost } from './member-api-keys-host'
import { memberKeyFixture } from './member-key-fixtures'
import { messages } from './member-key-test-messages'
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ children, ...props }: React.ComponentProps<'a'>) => (
    <a {...props}>{children}</a>
  ),
}))
vi.mock('@/entities/organization-context', () => ({ useMemberApiKeys: vi.fn() }))
const controller = {
  binding: 'a'.repeat(64),
  organizationId: 'org',
} as OrganizationAccessController
const target = { userId: 'user', memberId: 'member' }
const revoke = vi.fn()
const t = messages.memberApiKeys
function view(open = true) {
  return (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} timeZone="UTC" messages={messages}>
      <MemberApiKeysHost
        controller={controller}
        target={target}
        open={open}
        onClose={() => undefined}
      />
    </NextIntlClientProvider>
  )
}
function model(data = memberKeyFixture) {
  return {
    data,
    ready: true,
    available: true,
    pending: false,
    busy: false,
    error: undefined,
    retryAt: undefined,
    refresh: vi.fn().mockResolvedValue(data),
    revoke,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useMemberApiKeys).mockReturnValue(model() as never)
})
describe('member key interaction boundaries', () => {
  it('requires explicit confirmation and cancellation never calls the command', async () => {
    render(view())
    fireEvent.click(screen.getByRole('button', { name: t.revokeAll }))
    const confirmation = await screen.findByRole('alertdialog')
    expect(confirmation).toHaveTextContent(t.allWarning)
    fireEvent.click(within(confirmation).getByRole('button', { name: t.cancel }))
    expect(revoke).not.toHaveBeenCalled()
  })
  it('preserves unknown results across overlay close and reopen, without replay', async () => {
    revoke.mockResolvedValue({ status: 'unknown', error: new Error('Network lost') })
    const rendered = render(view())
    fireEvent.click(screen.getByRole('button', { name: t.revokeAll }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: t.confirm })
    )
    expect(await screen.findByText(t.unknown)).toBeVisible()
    rendered.rerender(view(false))
    rendered.rerender(view())
    expect(await screen.findByText(t.unknown)).toBeVisible()
    expect(screen.getByRole('button', { name: t.revokeAll })).toBeDisabled()
    expect(revoke).toHaveBeenCalledTimes(1)
  })
  it('1001 explains maintenance and disables all while leaving single revocation available', () => {
    vi.mocked(useMemberApiKeys).mockReturnValue(
      model({ ...memberKeyFixture, revocableCount: 1001 }) as never
    )
    render(view())
    expect(screen.getByText(t.limit)).toBeVisible()
    expect(screen.getByRole('button', { name: t.revokeAll })).toBeDisabled()
    expect(screen.getByRole('button', { name: t.revoke })).toBeEnabled()
  })
})
