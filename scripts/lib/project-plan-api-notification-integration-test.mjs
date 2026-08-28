// init:project --mode=single: notification.integration.spec.ts. Found via
// the real `pnpm --filter api test` in init-project.test.mjs — this file has
// one test per locale proving the CTA/footer chrome (from emailMessages)
// renders correctly; with only one locale left, they collapse to one. The
// other tests hardcode `locale: 'en'`, which stops being a valid value once
// a non-en locale is chosen, so they move to the kept locale too — the
// title/body content they assert on is caller-supplied free text, not a
// catalogue lookup, so it is locale-independent and stays as written.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `/**
 * Integration test for the generic Notification email template.
 *
 * Real React Email rendering (Vitest + happy-dom), no mocks — see ai/TESTING.md.
 */

import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'

import { NotificationEmail } from './notification'

describe('NotificationEmail Template (Integration)', () => {
  it('renders the dispatcher-supplied title/body and a CTA in Russian', async () => {
    const html = await render(
      NotificationEmail({
        title: 'Профиль обновлён',
        body: 'Вы изменили данные профиля.',
        actionUrl: 'https://app.example',
        locale: 'ru',
      })
    )

    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('Профиль обновлён')
    expect(html).toContain('Вы изменили данные профиля.')
    // Localized CTA chrome + the trusted app URL.
    expect(html).toContain('Открыть AMCore')
    expect(html).toContain('https://app.example')
    expect(html).toContain('С уважением, команда AMCore')
  })

  it('renders English chrome for the en locale', async () => {
    const html = await render(
      NotificationEmail({
        title: 'New notification',
        body: 'You have a new notification.',
        actionUrl: 'https://app.example',
        locale: 'en',
      })
    )
    expect(html).toContain('New notification')
    expect(html).toContain('Open AMCore')
    expect(html).toContain('Best regards, AMCore team')
  })

  it('omits the CTA button when there is no actionUrl', async () => {
    const html = await render(
      NotificationEmail({ title: 'Heads up', body: 'No action here.', locale: 'en' })
    )
    expect(html).toContain('Heads up')
    expect(html).not.toContain('Open AMCore')
  })

  it('escapes special characters in the supplied content', async () => {
    const html = await render(
      NotificationEmail({
        title: 'Quote "test" & <tag>',
        body: 'Body with <script>alert(1)</script>',
        locale: 'en',
      })
    )
    expect(html).toContain('Quote')
    // The raw script tag must be HTML-escaped, not passed through verbatim.
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('produces email-client-friendly HTML structure', async () => {
    const html = await render(
      NotificationEmail({ title: 'T', body: 'B', actionUrl: 'https://app.example', locale: 'en' })
    )
    expect(html).toMatch(/<table/i)
    expect(html).toMatch(/style="/i)
  })
})
`

const CHROME = {
  en: {
    title: 'New notification',
    body: 'You have a new notification.',
    openButton: 'Open AMCore',
    footer: 'Best regards, AMCore team',
  },
  ru: {
    title: 'Профиль обновлён',
    body: 'Вы изменили данные профиля.',
    openButton: 'Открыть AMCore',
    footer: 'С уважением, команда AMCore',
  },
}

function after(locale) {
  const chrome = CHROME[locale]
  return `/**
 * Integration test for the generic Notification email template.
 *
 * Real React Email rendering (Vitest + happy-dom), no mocks — see ai/TESTING.md.
 */

import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'

import { NotificationEmail } from './notification'

describe('NotificationEmail Template (Integration)', () => {
  it('renders the dispatcher-supplied title/body and CTA chrome', async () => {
    const html = await render(
      NotificationEmail({
        title: '${chrome.title}',
        body: '${chrome.body}',
        actionUrl: 'https://app.example',
        locale: '${locale}',
      })
    )

    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('${chrome.title}')
    expect(html).toContain('${chrome.body}')
    // Localized CTA chrome + the trusted app URL.
    expect(html).toContain('${chrome.openButton}')
    expect(html).toContain('https://app.example')
    expect(html).toContain('${chrome.footer}')
  })

  it('omits the CTA button when there is no actionUrl', async () => {
    const html = await render(
      NotificationEmail({ title: 'Heads up', body: 'No action here.', locale: '${locale}' })
    )
    expect(html).toContain('Heads up')
    expect(html).not.toContain('${chrome.openButton}')
  })

  it('escapes special characters in the supplied content', async () => {
    const html = await render(
      NotificationEmail({
        title: 'Quote "test" & <tag>',
        body: 'Body with <script>alert(1)</script>',
        locale: '${locale}',
      })
    )
    expect(html).toContain('Quote')
    // The raw script tag must be HTML-escaped, not passed through verbatim.
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('produces email-client-friendly HTML structure', async () => {
    const html = await render(
      NotificationEmail({ title: 'T', body: 'B', actionUrl: 'https://app.example', locale: '${locale}' })
    )
    expect(html).toMatch(/<table/i)
    expect(html).toMatch(/style="/i)
  })
})
`
}

export function buildApiNotificationIntegrationTestSteps(root, locale) {
  return [
    exactContentStep(
      path.join(
        root,
        'apps/api/src/infrastructure/email/templates/notification.integration.spec.ts'
      ),
      { expectedBefore: BEFORE, after: after(locale) },
      'notification.integration.spec.ts: test only the kept locale'
    ),
  ]
}
