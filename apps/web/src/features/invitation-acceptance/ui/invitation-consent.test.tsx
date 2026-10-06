import { NextIntlClientProvider } from 'next-intl'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import messages from '../../../../messages/en.json'

import { InvitationConsent } from './invitation-consent'
import { readyInvitation } from './invitation-consent.fixture'

describe('invitation explicit consent', () => {
  function setup(state: 'idle' | 'pending' | 'unknown') {
    const actions = { onAccept: vi.fn(), onRecover: vi.fn(), onLeave: vi.fn() }
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <InvitationConsent
          invitation={readyInvitation}
          accountEmail="person@example.test"
          timeZone="UTC"
          state={state}
          {...actions}
        />
      </NextIntlClientProvider>
    )
    return actions
  }

  it('shows the complete role set and joins only after a deliberate click', () => {
    const actions = setup('idle')
    expect(screen.getByRole('heading', { name: messages.invitationRecipient.consentTitle.replace('{organization}', 'Acme Studio') })).toBeInTheDocument()
    expect(screen.getByText('MEMBER')).toBeInTheDocument()
    expect(screen.getByText('Editor')).toBeInTheDocument()
    expect(actions.onAccept).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: messages.invitationRecipient.accept }))
    expect(actions.onAccept).toHaveBeenCalledOnce()
  })

  it('keeps unknown settlement separate from a new acceptance', () => {
    const actions = setup('unknown')
    expect(screen.getByRole('button', { name: messages.invitationRecipient.accept })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: messages.invitationRecipient.recover }))
    expect(actions.onRecover).toHaveBeenCalledOnce()
    expect(actions.onAccept).not.toHaveBeenCalled()
  })

  it('allows leaving while a request is pending without invoking revoke or another accept', () => {
    const actions = setup('pending')
    expect(screen.getByRole('button', { name: messages.invitationRecipient.accept })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: messages.invitationRecipient.leave }))
    expect(actions.onLeave).toHaveBeenCalledOnce()
    expect(actions.onAccept).not.toHaveBeenCalled()
  })
})
