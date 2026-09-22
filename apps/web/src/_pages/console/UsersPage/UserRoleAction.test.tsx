import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE, SystemRole } from '@amcore/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '../../../../messages/en.json'

import { useUserRoleChange } from './use-user-role-change'
import { UserRoleAction } from './UserRoleAction'

vi.mock('./use-user-role-change', () => ({ useUserRoleChange: vi.fn() }))
vi.mock('./RoleStepUpDialog', () => ({ RoleStepUpDialog: () => null }))

const confirmRoleChange = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useUserRoleChange).mockReturnValue({
    confirmRoleChange,
    isSubmitting: false,
    stepUp: { kind: 'closed' },
    isSteppingUp: false,
    submitStepUp: vi.fn(),
    closeStepUp: vi.fn(),
  })
})

function renderAction(user: { id: string; systemRole: SystemRole }, isSelf: boolean) {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={en}>
      <UserRoleAction user={user} isSelf={isSelf} />
    </NextIntlClientProvider>
  )
}

async function openRowMenu() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Actions' }))
  return user
}

describe('UserRoleAction', () => {
  it("renders nothing for the signed-in operator's own row", () => {
    renderAction({ id: 'u1', systemRole: SystemRole.SuperAdmin }, true)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers "promote" for a USER, behind the row actions menu, and confirms via the hook', async () => {
    renderAction({ id: 'u1', systemRole: SystemRole.User }, false)
    const user = await openRowMenu()

    await user.click(await screen.findByRole('menuitem', { name: 'Promote to admin' }))
    const dialog = within(await screen.findByRole('alertdialog'))
    await user.click(dialog.getByRole('button', { name: 'Promote to admin' }))

    expect(confirmRoleChange).toHaveBeenCalledTimes(1)
  })

  it('offers "demote" for a SUPER_ADMIN', async () => {
    renderAction({ id: 'u1', systemRole: SystemRole.SuperAdmin }, false)
    const user = await openRowMenu()

    await user.click(await screen.findByRole('menuitem', { name: 'Remove admin access' }))

    expect(await screen.findByText('Remove admin access?')).toBeInTheDocument()
  })
})
