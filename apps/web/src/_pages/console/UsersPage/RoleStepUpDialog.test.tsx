import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import en from '../../../../messages/en.json'

import { RoleStepUpDialog } from './RoleStepUpDialog'
import type { StepUpPhase } from './use-user-role-change'

function renderDialog(phase: StepUpPhase, onSubmit = vi.fn(), onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={en}>
      <RoleStepUpDialog phase={phase} isSubmitting={false} onSubmit={onSubmit} onClose={onClose} />
    </NextIntlClientProvider>
  )
  return { onSubmit, onClose }
}

describe('RoleStepUpDialog', () => {
  it('renders nothing visible when closed', () => {
    renderDialog({ kind: 'closed' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the password form when open with no error yet', () => {
    renderDialog({ kind: 'open' })

    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
  })

  it('lets the operator retry after a recoverable error (wrong password)', () => {
    renderDialog({ kind: 'error', message: 'Incorrect email or password.', terminal: false })

    expect(screen.getByText('Incorrect email or password.')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
  })

  it('replaces the form with only a close action on a terminal error', () => {
    renderDialog({
      kind: 'error',
      message: "Password confirmation isn't available for this account.",
      terminal: true,
    })

    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
  })

  it('calls onSubmit with the entered password and clears the field', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderDialog({ kind: 'open' })

    await user.type(screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onSubmit).toHaveBeenCalledWith('correct-horse')
  })

  it('calls onClose when the operator cancels', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog({ kind: 'open' })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
  })
})
