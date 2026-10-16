/**
 * JSON-LD for a public page: `<JsonLd data={{ '@context': 'https://schema.org', ... }} />`.
 *
 * `JSON.stringify` does not make a string safe inside a `<script>` tag: a value containing
 * `</script>` would end the tag and inject markup. Every `<` is therefore written as the escape
 * `\u003c`, which JSON parsers read back as `<` (the approach of the Next.js JSON-LD guide). The
 * script has type `application/ld+json`, a data block the strict CSP does not execute or block
 * (verified in the enforced mode), so it needs no nonce. React would HTML-escape a text child of
 * `<script>` and corrupt the JSON, hence `dangerouslySetInnerHTML` on already-escaped text.
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}
