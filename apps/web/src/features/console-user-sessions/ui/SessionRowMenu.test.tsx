import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRevokeSession } from '../model/use-revoke-session'

import { SessionRowMenu } from './SessionRowMenu'

vi.mock('../model/use-revoke-session', () => ({ useRevokeSession: vi.fn() }))
vi.mock('@/shared/ui/console-step-up-dialog', () => ({ ConsoleStepUpDialog: () => null }))

const messages = {
  console: {
    userSessionsActionsFor: 'Actions for session on {device}',
    userSessionsRevokeOne: 'Revoke session',
    userSessionsRevokeOneConfirmTitle: 'Revoke this session?',
    userSessionsRevokeOneConfirmDescription:
      "This ends {device}'s session for {email}. Future refresh is blocked immediately.",
  },
  common: { cancel: 'Cancel' },
}

const confirm = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useRevokeSession).mockReturnValue({
    confirm,
    isSubmitting: false,
    stepUp: { kind: 'closed' },
    isSteppingUp: false,
    submitStepUp: vi.fn(),
    closeStepUp: vi.fn(),
  })
})

function renderMenu() {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <SessionRowMenu
        userId="user-1"
        sessionId="family-1"
        deviceLabel="Chrome on macOS"
        targetEmail="target@example.com"
      />
    </NextIntlClientProvider>
  )
}

describe('SessionRowMenu', () => {
  it('has a row-specific accessible name for the actions trigger, not a bare "Actions"', () => {
    renderMenu()

    expect(
      screen.getByRole('button', { name: 'Actions for session on Chrome on macOS' })
    ).toBeInTheDocument()
  })

  it('confirms via the hook after the operator confirms the destructive dialog', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Actions for session on Chrome on macOS' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Revoke session' }))
    const dialog = within(await screen.findByRole('alertdialog'))
    expect(dialog.getByText(/target@example\.com/)).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Revoke session' }))

    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
