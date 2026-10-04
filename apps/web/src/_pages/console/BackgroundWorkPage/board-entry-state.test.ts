import { describe, expect, it } from 'vitest'

import { queueBoardHref, resolveBoardEntryState } from './board-entry-state'
import { availableQueue, disabledQueue, unavailableQueue } from './queue-fixtures'

const available = { state: 'available' } as const
const disabled = { state: 'disabled' } as const

describe('resolveBoardEntryState', () => {
  it.each([
    [null, false, 'none'],
    [null, true, 'none'],
    [undefined, true, 'none'],
    [available, false, 'available'],
    [available, true, 'open-failed'],
    [disabled, false, 'disabled'],
    // A fresh confirmed "disabled" outranks the historical failed-open marker.
    [disabled, true, 'disabled'],
  ] as const)('board %j with open-failed %s is %s', (board, openFailed, expected) => {
    expect(resolveBoardEntryState(board, openFailed)).toBe(expected)
  })

  it('never turns lost access into disabled or failed', () => {
    expect(resolveBoardEntryState(null, true)).toBe('none')
  })
})

describe('queueBoardHref', () => {
  it('links a queue that is in the board while the board is available', () => {
    expect(queueBoardHref(availableQueue('email'), true)).toBe(
      '/api/console/bull-board/queue/email'
    )
    expect(queueBoardHref(unavailableQueue('notifications'), true)).toBe(
      '/api/console/bull-board/queue/notifications'
    )
  })

  it('has no link for a queue without a board adapter', () => {
    expect(queueBoardHref(availableQueue('ai-runs'), true)).toBeNull()
    expect(queueBoardHref(disabledQueue('default'), true)).toBeNull()
  })

  it('has no link at all while the board is not confirmed available, even for queues in it', () => {
    expect(queueBoardHref(availableQueue('email'), false)).toBeNull()
  })

  it('encodes the queue name as one path segment', () => {
    expect(queueBoardHref({ ...availableQueue('email'), name: 'a/b' }, true)).toBe(
      '/api/console/bull-board/queue/a%2Fb'
    )
  })
})
