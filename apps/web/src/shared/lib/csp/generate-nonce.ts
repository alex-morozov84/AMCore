import 'server-only'

/**
 * A fresh, unpredictable nonce for this request's CSP `script-src`/
 * `style-src-elem`. Matches Next's own documented pattern exactly (the
 * installed `content-security-policy.md` guide under
 * `apps/web/node_modules/next/dist/docs/`): base64-encode a random UUID's
 * bytes rather than exposing the UUID's hyphenated string form directly,
 * since CSP nonce values are conventionally base64. `crypto` is a Web
 * Crypto API global available in both the Node.js and Edge runtimes — no
 * import needed.
 */
export function generateNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64')
}
