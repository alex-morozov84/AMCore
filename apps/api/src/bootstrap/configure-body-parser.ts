import type { NestExpressApplication } from '@nestjs/platform-express'

/**
 * Maximum accepted size, in bytes, of a parsed request body.
 *
 * This is a decimal **100 000 bytes**, not 100 KiB. body-parser's `limit`
 * counts the **decoded** body — bytes after any `Content-Encoding` inflation
 * (`inflate` defaults to true), not bytes on the wire — and its implicit default
 * is the string `'100kb'`, which the `bytes` library expands to 102 400 (binary).
 * Pinning a number removes that ambiguity: a decoded body of exactly 100 000
 * bytes is accepted; 100 001 is rejected with an `entity.too.large` error, which
 * `AllExceptionsFilter` maps to a stable `413 PAYLOAD_TOO_LARGE` response. For an
 * uncompressed request the decoded size equals the wire size; for a gzip/deflate
 * request the limit bounds the inflated size (a small compressed body that
 * inflates past the limit is still rejected).
 *
 * The same ceiling applies to raw-body webhook routes (D4): there is no measured
 * payload that justifies a separate, larger webhook limit yet. Multipart uploads
 * are bounded separately by Multer and are unaffected by this value.
 */
export const REQUEST_BODY_LIMIT_BYTES = 100_000

/**
 * Register explicit JSON and urlencoded body-parser limits on the application.
 *
 * The app MUST be created with `{ rawBody: true }`. `useBodyParser` re-registers
 * each parser while preserving Nest's raw-body capture: `req.rawBody` is the
 * decoded (post-inflation) body buffer body-parser hands to its `verify` hook,
 * which is exactly what the webhook verifier hashes — re-registering with an
 * explicit limit does not change those bytes. Production (`main.ts`) and every
 * e2e bootstrap call this helper so the body-size contract is identical across
 * both — there is one production-like parser setup, not per-entrypoint drift.
 */
export function configureBodyParser(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: REQUEST_BODY_LIMIT_BYTES })
  app.useBodyParser('urlencoded', { limit: REQUEST_BODY_LIMIT_BYTES, extended: true })
}
