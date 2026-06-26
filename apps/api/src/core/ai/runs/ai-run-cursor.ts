import { z } from 'zod'

/**
 * Opaque, versioned keyset cursor for the AI run list (Track C — ADR-054, Arc C.2; ADR-036
 * endpoint-local exception). Encodes the last row's `(createdAt, id)` — the list's strict order key
 * `(createdAt DESC, id DESC)` — so paging never duplicates or skips a run as new runs are queued.
 * Versioned so the encoding can change without silently misreading an old client's token. The token
 * is intentionally unsigned/opaque — not a security boundary — so it is validated for shape only.
 */

const CURSOR_VERSION = 'v1'

// Exact encoder shape: an ISO instant and a bounded non-empty id, no extra fields.
const cursorPayloadSchema = z.object({ c: z.iso.datetime(), i: z.string().min(1).max(64) }).strict()

export interface AiRunCursor {
  createdAt: Date
  id: string
}

/** Thrown for a malformed or version-mismatched cursor; the controller maps it to 400. */
export class InvalidAiRunCursorError extends Error {
  constructor() {
    super('Invalid run cursor')
    this.name = 'InvalidAiRunCursorError'
  }
}

export function encodeAiRunCursor(cursor: AiRunCursor): string {
  const payload = JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })
  return `${CURSOR_VERSION}.${Buffer.from(payload).toString('base64url')}`
}

export function decodeAiRunCursor(token: string): AiRunCursor {
  const separator = token.indexOf('.')
  const version = separator === -1 ? '' : token.slice(0, separator)
  const data = separator === -1 ? '' : token.slice(separator + 1)
  if (version !== CURSOR_VERSION || data.length === 0) throw new InvalidAiRunCursorError()

  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
  } catch {
    throw new InvalidAiRunCursorError()
  }

  const parsed = cursorPayloadSchema.safeParse(raw)
  if (!parsed.success) throw new InvalidAiRunCursorError()

  return { createdAt: new Date(parsed.data.c), id: parsed.data.i }
}
