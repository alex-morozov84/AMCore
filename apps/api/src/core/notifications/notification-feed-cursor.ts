/**
 * Opaque, versioned keyset cursor for the notification feed (ADR-036 endpoint-local
 * exception). Encodes the last row's `(createdAt, id)` — the feed's strict order key —
 * so paging never duplicates or skips rows as new notifications arrive. Versioned so
 * the encoding can change without silently misreading an old client's token.
 */

const CURSOR_VERSION = 'v1'

export interface FeedCursor {
  createdAt: Date
  id: string
}

/** Thrown for a malformed/old/forged cursor; the controller maps it to 400. */
export class InvalidFeedCursorError extends Error {
  constructor() {
    super('Invalid feed cursor')
    this.name = 'InvalidFeedCursorError'
  }
}

export function encodeFeedCursor(cursor: FeedCursor): string {
  const payload = JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })
  return `${CURSOR_VERSION}.${Buffer.from(payload).toString('base64url')}`
}

export function decodeFeedCursor(token: string): FeedCursor {
  const separator = token.indexOf('.')
  const version = separator === -1 ? '' : token.slice(0, separator)
  const data = separator === -1 ? '' : token.slice(separator + 1)
  if (version !== CURSOR_VERSION || data.length === 0) throw new InvalidFeedCursorError()

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
  } catch {
    throw new InvalidFeedCursorError()
  }

  if (!parsed || typeof parsed !== 'object') throw new InvalidFeedCursorError()
  const { c, i } = parsed as Record<string, unknown>
  if (typeof c !== 'string' || typeof i !== 'string') throw new InvalidFeedCursorError()

  const createdAt = new Date(c)
  if (Number.isNaN(createdAt.getTime())) throw new InvalidFeedCursorError()

  return { createdAt, id: i }
}
