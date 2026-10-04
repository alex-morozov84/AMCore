import { z } from 'zod'

import { SUPPORTED_LOCALES } from '../constants'

/**
 * Contract between the Console BFF and the API for the read-only queue board (Bull Board).
 *
 * The BFF tells the API how to RENDER the board (public base path, language, the way back to the
 * Console) in one request header. It is presentation metadata, never a credential and never an
 * authorization input: the API honours it only on a bearer-authenticated request and ignores the
 * organization/role of anything inside it (there is nothing of that kind to read).
 */
export const BULL_BOARD_CONTEXT_HEADER = 'x-amcore-board-context'

/**
 * Response CSP of the board (its HTML and API). The board UI runs only its own bundled scripts, so
 * `script-src` is `'self'`; it injects styles at runtime, hence `'unsafe-inline'` for styles ONLY;
 * it may be framed by nobody. There is deliberately no `report-uri`/`report-to`. The unmodified
 * board HTML links a Google Fonts stylesheet: this policy blocks it (a known, documented console
 * message; the UI falls back to system fonts). The Console's own CSP is not touched.
 */
export const BULL_BOARD_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ')

/** A site-relative path made of plain path characters: no scheme, no `//`, no `..`, no backslash. */
function relativePath(maxLength: number) {
  return z
    .string()
    .max(maxLength)
    .regex(/^\/[A-Za-z0-9._~/-]*$/)
    .refine((value) => !value.includes('//') && !value.split('/').includes('..'))
}

export const boardRenderContextSchema = z
  .object({
    /** Where the browser reaches the board; becomes the page's `<base>`. Ends without a slash. */
    basePath: relativePath(200),
    locale: z.enum(SUPPORTED_LOCALES),
    /** Console page the "back" link points to (no query, no host). */
    returnHref: relativePath(300),
  })
  .strict()
export type BoardRenderContext = z.infer<typeof boardRenderContextSchema>

/** The wire form is `base64url(JSON)` of this object; each app encodes/decodes it with its own `Buffer`. */
export const BULL_BOARD_CONTEXT_MAX_HEADER_LENGTH = 1024

/** `null` for anything that is not exactly a valid context: wrong type, extra keys, unsafe paths. */
export function parseBoardRenderContext(value: unknown): BoardRenderContext | null {
  const parsed = boardRenderContextSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
