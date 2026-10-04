import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BoardEntryState } from './board-entry-state'
import { BoardNotices, BoardOpenAction } from './BoardEntry'
import { queueMessages } from './queue-test-messages'

const HREF = '/api/console/bull-board'
const GUIDE = 'https://docs.example.test/queue-board#enabling-the-board'

function wrap(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={queueMessages}>
      {children}
    </NextIntlClientProvider>
  )
}

function notices(state: BoardEntryState) {
  render(wrap(<BoardNotices state={state} guideHref={GUIDE} />))
}

describe('BoardOpenAction', () => {
  it('opens the board in a new tab, without opener or referrer, and says so', () => {
    render(wrap(<BoardOpenAction href={HREF} onOpen={vi.fn()} />))
    const link = screen.getByRole('link', { name: /Open queue board/ })
    expect(link).toHaveAttribute('href', HREF)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('(opens in a new tab)')
  })

  it('carries the standing view-only explanation in a help icon beside the button', () => {
    render(wrap(<BoardOpenAction href={HREF} onOpen={vi.fn()} />))
    const help = screen.getByLabelText(/Retrying or deleting jobs and managing queues/)
    expect(help.getAttribute('aria-label')).toMatch(/some job details are hidden/)
  })

  it('tells the page the visitor is trying again, to clear a stale notice', () => {
    const onOpen = vi.fn()
    render(wrap(<BoardOpenAction href={HREF} onOpen={onOpen} />))
    fireEvent.click(screen.getByRole('link', { name: /Open queue board/ }))
    expect(onOpen).toHaveBeenCalledOnce()
  })
})

describe('BoardNotices', () => {
  it.each(['none', 'available'] as const)('shows nothing at all (%s)', (state) => {
    notices(state)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('says the last attempt failed, as a status and not as a setting problem', () => {
    notices('open-failed')
    expect(screen.getByRole('status')).toHaveTextContent('Could not open the queue board')
    expect(document.body.textContent).not.toContain('ENABLE_BULL_BOARD')
  })

  it('explains how to turn the board on when it is confirmed disabled', () => {
    notices('disabled')
    const note = screen.getByText('Queue board is not enabled').closest('[data-slot="alert"]')!
    expect(note).toHaveAttribute('role', 'note')
    expect(note.textContent).toContain('ENABLE_BULL_BOARD=true')
    expect(note.textContent).toContain('restart the API')
    expect(note.textContent).toContain('not in the .env file')
    expect(note.textContent).toContain('it stays view-only')
    expect(note.querySelectorAll('code')).toHaveLength(4)
    const guide = screen.getByRole('link', { name: /Queue board guide/ })
    expect(guide).toHaveAttribute('href', GUIDE)
    expect(guide).toHaveAttribute('target', '_blank')
    expect(guide).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
