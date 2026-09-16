const CATEGORIES = {
  en: "['one', 'other']",
  ru: "['one', 'few', 'many', 'other']",
}

const EMAIL_MESSAGES_SUITE = `describe('emailMessages i18n completeness', () => {
  const messages = emailMessages.__LOCALE__

  it('has no empty message values', () => {
    const empties = Object.entries(messages)
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([id]) => id)
    expect(empties).toEqual([])
  })

  /**
   * CLDR plural categories the one supported locale must supply whenever a
   * message uses an ICU \`plural\` argument.
   */
  const REQUIRED_PLURAL_CATEGORIES = __CATEGORIES__

  it('supplies every required plural category', () => {
    const offenders: string[] = []

    for (const [id, value] of Object.entries(messages)) {
      if (!/\\{[^}]*,\\s*plural\\s*,/.test(value)) continue
      for (const category of REQUIRED_PLURAL_CATEGORIES) {
        if (!new RegExp(\`\\\\b\${category}\\\\s*\\\\{\`).test(value)) {
          offenders.push(\`\${id} is missing "\${category}"\`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('actually has pluralized messages to check', () => {
    // Guards the guard: the check above passes vacuously if no message uses a
    // plural, which would hide a regression that stripped them.
    const pluralized = Object.values(messages).filter((value) =>
      /\\{[^}]*,\\s*plural\\s*,/.test(value)
    )
    expect(pluralized.length).toBeGreaterThanOrEqual(3)
  })
})`

export function emailMessagesSuite(locale) {
  return EMAIL_MESSAGES_SUITE.replace('__LOCALE__', locale).replace(
    '__CATEGORIES__',
    CATEGORIES[locale]
  )
}

export const EMAIL_MESSAGES_DOC = `/**
 * i18n completeness guard (EQS-08).
 *
 * FormatJS renders a missing message id as the literal id string (non-fatal, by
 * design — see the render-robustness integration test). With only one
 * supported locale left, there is nothing to compare it against for parity —
 * this proves the one catalogue is actually complete instead.
 */`

const CHROME = {
  en: [
    'New notification',
    'You have a new notification.',
    'Open AMCore',
    'Best regards, AMCore team',
  ],
  ru: [
    'Профиль обновлён',
    'Вы изменили данные профиля.',
    'Открыть AMCore',
    'С уважением, команда AMCore',
  ],
}

const NOTIFICATION_SUITE = `describe('NotificationEmail Template (Integration)', () => {
  it('renders the dispatcher-supplied title/body and CTA chrome', async () => {
    const html = await render(
      NotificationEmail({
        title: '__TITLE__',
        body: '__BODY__',
        actionUrl: 'https://app.example',
        locale: '__LOCALE__',
      })
    )

    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('__TITLE__')
    expect(html).toContain('__BODY__')
    // Localized CTA chrome + the trusted app URL.
    expect(html).toContain('__BUTTON__')
    expect(html).toContain('https://app.example')
    expect(html).toContain('__FOOTER__')
  })

  it('omits the CTA button when there is no actionUrl', async () => {
    const html = await render(
      NotificationEmail({ title: 'Heads up', body: 'No action here.', locale: '__LOCALE__' })
    )
    expect(html).toContain('Heads up')
    expect(html).not.toContain('__BUTTON__')
  })

  it('escapes special characters in the supplied content', async () => {
    const html = await render(
      NotificationEmail({
        title: 'Quote "test" & <tag>',
        body: 'Body with <script>alert(1)</script>',
        locale: '__LOCALE__',
      })
    )
    expect(html).toContain('Quote')
    // The raw script tag must be HTML-escaped, not passed through verbatim.
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('produces email-client-friendly HTML structure', async () => {
    const html = await render(
      NotificationEmail({ title: 'T', body: 'B', actionUrl: 'https://app.example', locale: '__LOCALE__' })
    )
    expect(html).toMatch(/<table/i)
    expect(html).toMatch(/style="/i)
  })
})`

export function notificationSuite(locale) {
  const [title, body, button, footer] = CHROME[locale]
  return NOTIFICATION_SUITE.replaceAll('__LOCALE__', locale)
    .replaceAll('__TITLE__', title)
    .replaceAll('__BODY__', body)
    .replaceAll('__BUTTON__', button)
    .replaceAll('__FOOTER__', footer)
}
