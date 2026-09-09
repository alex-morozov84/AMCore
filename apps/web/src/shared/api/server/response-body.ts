import { classifyThrown } from './classify'
import type { UnavailableReason } from './types'

export type JsonBodyResult = { ok: true; body: unknown } | { ok: false; reason: UnavailableReason }

/**
 * Reads and parses a response body, distinguishing a body-stream failure
 * (network/timeout mid-read - an availability outcome) from genuinely
 * malformed JSON (a caller-visible contract error) and from the caller's
 * own cancellation (rethrown - not this transport's concern to classify).
 */
export async function readJsonBody(
  response: Response,
  isCallerCancelled: () => boolean
): Promise<JsonBodyResult> {
  try {
    return { ok: true, body: await response.json() }
  } catch (error) {
    if (isCallerCancelled()) throw error
    const reason = classifyThrown(error)
    if (reason !== null) return { ok: false, reason }
    if (error instanceof SyntaxError) return { ok: true, body: undefined } // malformed JSON
    throw error // genuinely unrecognized - must not be silently absorbed
  }
}
