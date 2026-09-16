export const RENDER_DOC = `/**
 * i18n / render-robustness integration tests (EQS-08).
 *
 * Real React Email rendering (no mocks), Vitest + happy-dom. Covers the welcome,
 * secret-bearing (reset/verification/invite) templates in the one supported
 * locale and asserts:
 *  - non-empty HTML with the expected localized content,
 *  - NO raw message-id leakage (a missing key would render its literal id),
 *  - a non-empty plaintext alternative (\`render(node, { plainText: true })\`)
 *    that contains the localized words and no HTML tags,
 *  - locale fallback to the one supported locale when \`locale\` is omitted.
 *
 * @see https://react.email/docs/introduction#testing
 */`

const RENDER_SUITE = `describe('email templates — render robustness (EQS-08)', () => {
  describe.each(cases)('$name', ({ namespace, build, expectedWord }) => {
    it('renders translated HTML with no message-id leak', async () => {
      const html = await render(build('__LOCALE__'))

      expect(html).toBeTruthy()
      expect(html).toContain(expectedWord)
      // A missing translation would render the literal id (e.g. "welcome.title").
      for (const id of localeIds(namespace)) {
        expect(html, \`unresolved message id "\${id}" leaked into HTML\`).not.toContain(id)
      }
    })

    it('produces a non-empty plaintext alternative', async () => {
      const text = await render(build('__LOCALE__'), { plainText: true })
      // html-to-text uppercases headings, so compare case-insensitively.
      const lower = text.toLowerCase()

      expect(text).toBeTruthy()
      expect(text.length).toBeGreaterThan(0)
      expect(lower).toContain(expectedWord.toLowerCase())
      // Plaintext must not carry HTML tags.
      expect(text).not.toMatch(/<[a-z!/][^>]*>/i)
      // ...and still not leak message ids (ids are lowercase).
      for (const id of localeIds(namespace)) {
        expect(lower).not.toContain(id.toLowerCase())
      }
    })
  })

  it('falls back to the one supported locale when locale is omitted', async () => {
    const html = await render(WelcomeEmail({ name: 'Ivan', email: 'ivan@example.com' }))

    expect(html).toContain('__WORD__')
    expect(html).not.toContain('__OTHER_WORD__')
  })
})`

export function renderSuite(locale, word, otherWord) {
  return RENDER_SUITE.replaceAll('__LOCALE__', locale)
    .replace('__WORD__', word)
    .replace('__OTHER_WORD__', otherWord)
}
