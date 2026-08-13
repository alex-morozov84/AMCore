import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { toast, Toaster } from './toast'

// Base UI's Toast marks the close button `aria-hidden="true"` until a
// toast reaches its `data-expanded` animation state, which jsdom's lack of
// real CSS-transition timing never flips — `getByRole('button', ...)` (a11y
// tree, respects `aria-hidden`) can't see it, so these assert on the
// `aria-label` directly instead. The label's *value* — not its runtime
// discoverability, already Base UI's own concern — is what these guard.
describe('Toaster', () => {
  it('renders a toast added via toast.add(), with the caller-supplied close label', async () => {
    render(<Toaster closeLabel="Close" />)

    act(() => {
      toast.add({ title: 'Session revoked' })
    })

    expect(await screen.findByText('Session revoked')).toBeInTheDocument()
    expect(document.querySelector('[aria-label="Close"]')).toBeInTheDocument()
  })

  it('dismisses the toast when the close button is clicked', async () => {
    const user = userEvent.setup()
    render(<Toaster closeLabel="Close" />)

    act(() => {
      toast.add({ title: 'Dismiss me' })
    })
    expect(await screen.findByText('Dismiss me')).toBeInTheDocument()

    await user.click(document.querySelector('[aria-label="Close"]')!)

    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument()
  })

  it('uses the locale-supplied close label, not a hardcoded English fallback', async () => {
    render(<Toaster closeLabel="Закрыть" />)

    act(() => {
      toast.add({ title: 'Сессия отозвана' })
    })

    await screen.findByText('Сессия отозвана')
    expect(document.querySelector('[aria-label="Закрыть"]')).toBeInTheDocument()
  })
})
