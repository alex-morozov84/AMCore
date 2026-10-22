import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Alert, AlertDescription } from './alert'

function notice(id = 'first') {
  return (
    <>
      <h2 id="destination" tabIndex={-1}>
        Team
      </h2>
      <Alert
        key={id}
        showCloseButton
        closeLabel="Close notification"
        dismissFocusTargetId="destination"
      >
        <AlertDescription>Saved</AlertDescription>
      </Alert>
    </>
  )
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'checkVisibility', {
    configurable: true,
    value: vi.fn(() => true),
  })
})
afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'checkVisibility')
  vi.restoreAllMocks()
})
describe('Alert dismissal', () => {
  it('keeps the default presentation without a close control', () => {
    render(<Alert>Information</Alert>)
    expect(screen.getByRole('alert')).toHaveTextContent('Information')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('focuses the exact destination before hiding; only a new message key reopens it', () => {
    vi.spyOn(HTMLElement.prototype, 'checkVisibility').mockReturnValue(true)
    const view = render(notice())
    expect(document.activeElement).toBe(document.body)
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('heading')).toHaveFocus()
    view.rerender(notice())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    view.rerender(notice('next'))
    expect(screen.getByRole('alert')).toHaveTextContent('Saved')
  })
  it.each(['missing', 'hidden', 'disabled', 'inside'])(
    'does not hide when the target is %s',
    (kind) => {
      vi.spyOn(HTMLElement.prototype, 'checkVisibility').mockReturnValue(kind !== 'hidden')
      render(
        <>
          {kind !== 'missing' && kind !== 'inside' && (
            <button id="destination" disabled={kind === 'disabled'}>
              Target
            </button>
          )}
          <Alert showCloseButton closeLabel="Close notification" dismissFocusTargetId="destination">
            {kind === 'inside' ? <button id="destination">Inside</button> : 'Saved'}
          </Alert>
        </>
      )
      const close = screen.getByRole('button', { name: 'Close notification' })
      close.focus()
      fireEvent.click(close)
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(close).toHaveFocus()
    }
  )
})
