/**
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
