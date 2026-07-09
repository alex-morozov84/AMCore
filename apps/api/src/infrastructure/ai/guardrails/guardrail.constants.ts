/**
 * AI guardrail baseline constants (Track C — ADR-054 / ADR-055, Arc D). Structural trust-boundary
 * primitives for the text-generation tier. Everything here is content-free and secret-free.
 *
 * The boundary tag is salted per run with a nonce that is a collision-hardening / leak canary —
 * **not** a security secret. Safety must never depend on the user being unable to learn the nonce;
 * the JSON-encoded structural separation is the real boundary (see `trust-boundary.builder.ts`).
 */

/** Tag-name prefix for the salted untrusted-content boundary; the per-run nonce is appended. */
export const GUARDRAIL_BOUNDARY_TAG_PREFIX = 'amcore:user-data-'

/** Bytes of CSPRNG randomness for the per-run boundary nonce (base64url → ~12 printable chars). */
export const GUARDRAIL_NONCE_BYTES = 9

/**
 * Conservative default ceiling on the assembled untrusted user text, in characters. The builder
 * only **reports** oversize; the executor (Arc D.4) turns it into a bounded, non-retryable terminal
 * reason. Env `AI_GUARDRAIL_MAX_INPUT_CHARS` overrides this at the call site (Arc D.4).
 */
export const GUARDRAIL_DEFAULT_MAX_INPUT_CHARS = 100_000
