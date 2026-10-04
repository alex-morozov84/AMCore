import type { AdminQueue, AdminQueuesResponse } from '@amcore/shared'

import { getConsoleQueueBoardHref } from '@/shared/lib/console-public-href'

/**
 * What the queue board entry shows. One rule decides it, top to bottom, first match wins:
 * 1. `none`: no live data (access is being re-verified or was lost) — no board entry at all.
 *    Losing access is never turned into "disabled" or "could not open".
 * 2. `disabled`: the FRESH summary confirms the board was not mounted at API startup. It outranks
 *    the historical "could not open" marker, which only says an earlier attempt failed.
 * 3. `open-failed`: the board is available now, but the attempt that sent the visitor here failed.
 * 4. `available`.
 */
export type BoardEntryState = 'none' | 'available' | 'open-failed' | 'disabled'

export function resolveBoardEntryState(
  board: AdminQueuesResponse['board'] | null | undefined,
  openFailed: boolean
): BoardEntryState {
  if (!board) return 'none'
  if (board.state === 'disabled') return 'disabled'
  return openFailed ? 'open-failed' : 'available'
}

/**
 * Deep link of a queue row into the board: only when the board is CONFIRMED available now AND the
 * queue has an adapter there (`inBoard` is membership, not availability: with the board off the
 * rows must not keep live links). The board's own route for a queue is `queue/<name>`.
 */
export function queueBoardHref(queue: AdminQueue, boardAvailable: boolean): string | null {
  if (!boardAvailable || !queue.inBoard) return null
  return `${getConsoleQueueBoardHref()}/queue/${encodeURIComponent(queue.name)}`
}
