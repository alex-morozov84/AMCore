import { useRef, useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type OrganizationAccessController,
  useMemberRemoval,
} from '@/entities/organization-context'
import { ApiRequestError } from '@/shared/api/http-client'

import { MemberRemoval } from './member-removal'
import { messages } from './member-removal-test-messages'
vi.mock('@/entities/organization-context', () => ({ useMemberRemoval: vi.fn() }))
vi.mock('@/shared/ui/toast', () => ({ toast: { add: vi.fn() } }))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ children, ...props }: React.ComponentProps<'a'>) => (
    <a {...props}>{children}</a>
  ),
}))
const remove = vi.fn(),
  inspect = vi.fn()
function Harness({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} timeZone="UTC" messages={messages}>
      <h2 ref={heading} tabIndex={-1}>
        Members
      </h2>
      <MemberRemoval
        controller={{} as OrganizationAccessController}
        target={{
          userId: 'self',
          memberId: 'm',
          email: 'person@example.test',
          organizationName: 'Example',
        }}
        actorId="self"
        organizationsHref="/organizations"
        heading={heading}
        open={open}
        onOpenChange={setOpen}
        onLock={() => undefined}
      />
    </NextIntlClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useMemberRemoval).mockReturnValue({
    outcome: undefined,
    inspection: undefined,
    pending: false,
    checking: false,
    busy: false,
    canRemove: true,
    remove,
    inspect,
  })
})
describe('member removal confirmation and persistent result', () => {
  it('always explains keys and self access loss; Cancel sends no command', async () => {
    render(<Harness />)
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(messages.memberRemoval.warning)
    expect(dialog).toHaveTextContent(messages.memberRemoval.selfWarning)
    expect(dialog).toHaveTextContent('Example')
    expect(dialog).toHaveTextContent('person@example.test')
    fireEvent.click(within(dialog).getByRole('button', { name: messages.memberRemoval.cancel }))
    expect(remove).not.toHaveBeenCalled()
  })
  it('keeps unknown inspection visible after confirmation closes without replay', async () => {
    vi.mocked(useMemberRemoval).mockReturnValue({
      outcome: { status: 'unknown', error: new Error('lost') },
      inspection: undefined,
      pending: false,
      checking: false,
      busy: false,
      canRemove: false,
      remove,
      inspect,
    })
    render(<Harness />)
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: messages.memberRemoval.cancel,
      })
    )
    expect(screen.getByText(messages.memberRemoval.unknown)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: messages.memberRemoval.check }))
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
  })
})

it('shows a known last-admin refusal without unknown-result inspection', () => {
  const error = new ApiRequestError(400, { errorCode: 'BUSINESS_RULE_VIOLATION' } as never)
  vi.mocked(useMemberRemoval).mockReturnValue({
    ...{
      inspection: undefined,
      pending: false,
      checking: false,
      busy: false,
      canRemove: false,
      remove,
      inspect,
    },
    outcome: { status: 'rejected', error },
    inspection: { status: 'same', memberId: 'm' },
  })
  render(<Harness initialOpen={false} />)
  expect(screen.getByRole('alert')).toHaveTextContent(messages.memberRemoval.lastAdminTitle)
  expect(screen.queryByText(messages.memberRemoval.same)).toBeNull()
  expect(screen.queryByRole('button', { name: messages.memberRemoval.check })).toBeNull()
})
it.each(['denied', 'error'] as const)('keeps self-removal success with followup %s', (followup) => {
  vi.mocked(useMemberRemoval).mockReturnValue({
    ...{
      inspection: undefined,
      pending: false,
      checking: false,
      busy: false,
      canRemove: false,
      remove,
      inspect,
    },
    outcome: { status: 'committed', result: { removed: true }, followup },
  })
  render(<Harness initialOpen={false} />)
  expect(screen.getByRole('status')).toHaveTextContent(messages.memberRemoval.selfSuccessTitle)
  expect(screen.getByRole('link', { name: messages.memberRemoval.organizations })).toHaveAttribute(
    'href',
    '/organizations'
  )
  expect(screen.queryByRole('button', { name: messages.memberRemoval.check })).toBeNull()
  expect(Boolean(screen.queryByText(messages.memberRemoval.refreshFailed))).toBe(
    followup === 'error'
  )
})
