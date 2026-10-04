'use client'

import { useEffect, useState } from 'react'

const MARKER = 'board'

/**
 * The one-shot "could not open the board" notice. The BFF sends a page load that failed back to this
 * page with `?board=unavailable`; that says only that an earlier attempt failed, not what the board
 * is now. So the marker is removed from the address at once (a reload never brings it back) and the
 * notice is cleared by the events that make it stale: the visitor tries again, or the board's
 * confirmed state changes (e.g. it was enabled and the API restarted). A confirmed `disabled` at load
 * never starts it.
 */
export function useBoardOpenNotice(
  initiallyFailed: boolean,
  boardState: 'available' | 'disabled' | null
) {
  const [failed, setFailed] = useState(initiallyFailed && boardState !== 'disabled')
  const [seen, setSeen] = useState(boardState)

  // Adjust during render (not in an effect) when the confirmed state changes.
  if (boardState !== null && boardState !== seen) {
    setSeen(boardState)
    if (seen !== null) setFailed(false)
  }

  useEffect(() => {
    if (!initiallyFailed) return
    const url = new URL(window.location.href)
    if (!url.searchParams.has(MARKER)) return
    url.searchParams.delete(MARKER)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [initiallyFailed])

  return { failed, clear: () => setFailed(false) }
}
