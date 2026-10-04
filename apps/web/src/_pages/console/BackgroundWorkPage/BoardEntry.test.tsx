import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BoardEntryState } from './board-entry-state'
import { BoardEntry } from './BoardEntry'
import { queueMessages } from './queue-test-messages'

const HREF = '/api/console/bull-board'
const GUIDE = 'https://docs.example.test/queue-board#enabling-the-board'

function view(state: BoardEntryState, onOpen = vi.fn()) {
  render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={queueMessages}>
      <BoardEntry state={state} href={HREF} guideHref={GUIDE} onOpen={onOpen} />
    </NextIntlClientProvider>
  )
  return onOpen
}

describe('BoardEntry', () => {
  it.each(['none', 'available', 'open-failed', 'disabled'] as const)(
    'always shows the standing view-only note (%s), as a calm note and not an alert',
    (state) => {
      view(state)
      const note = screen.getByText('Queue board is view-only').closest('[data-slot="alert"]')
      expect(note).toHaveAttribute('role', 'note')
      expect(note).toHaveTextContent(
        /Retrying or deleting jobs and managing queues is not available/
      )
      expect(note).toHaveTextContent(/some job details are hidden/)
      expect(screen.queryByRole('alert')).toBeNull()
    }
  )

  it('opens the board in a new tab, without opener or referrer, and says so', () => {
    view('available')
    const link = screen.getByRole('link', { name: /Open queue board/ })
    expect(link).toHaveAttribute('href', HREF)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('(opens in a new tab)')
    expect(screen.queryByText('Queue board is not enabled')).toBeNull()
  })

  it('tells the visitor trying again to clear the stale notice', () => {
    const onOpen = view('open-failed')
    expect(screen.getByRole('status')).toHaveTextContent('Could not open the queue board')
    fireEvent.click(screen.getByRole('link', { name: /Open queue board/ }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('offers no button while the board is disabled, and explains how to turn it on', () => {
    view('disabled')
    expect(screen.queryByRole('link', { name: /Open queue board/ })).toBeNull()
    const note = screen.getByText('Queue board is not enabled').closest('[data-slot="alert"]')!
    expect(note).toHaveAttribute('role', 'note')
    expect(note.textContent).toContain('ENABLE_BULL_BOARD')
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

  it.each(['none', 'available', 'open-failed'] as const)(
    'never suggests ENABLE_BULL_BOARD unless the board is confirmed disabled (%s)',
    (state) => {
      view(state)
      expect(document.body.textContent).not.toContain('ENABLE_BULL_BOARD')
      expect(screen.queryByRole('link', { name: /Queue board guide/ })).toBeNull()
    }
  )

  it('shows only the note when there is no live data', () => {
    view('none')
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
