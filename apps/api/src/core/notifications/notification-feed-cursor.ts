import { z } from 'zod'

/**
 * Opaque, versioned keyset cursor for the notification feed (ADR-036 endpoint-local
 * exception). Encodes the last row's `(createdAt, id)` — the feed's strict order key —
 * so paging never duplicates or skips rows as new notifications arrive. Versioned so
 * the encoding can change without silently misreading an old client's token. The
 * token is intentionally unsigned/opaque — not a security boundary — so it is only
 * validated for shape, not authenticity.
 */

const CURSOR_VERSION = 'v1'

// Exact encoder shape: an ISO instant and a bounded non-empty id, no extra fields.
const cursorPayloadSchema = z.object({ c: z.iso.datetime(), i: z.string().min(1).max(64) }).strict()

export interface FeedCursor {
  createdAt: Date
  id: string
}

/** Thrown for a malformed or version-mismatched cursor; the controller maps it to 400. */
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

  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
  } catch {
    throw new InvalidFeedCursorError()
  }

  const parsed = cursorPayloadSchema.safeParse(raw)
  if (!parsed.success) throw new InvalidFeedCursorError()

  return { createdAt: new Date(parsed.data.c), id: parsed.data.i }
}
