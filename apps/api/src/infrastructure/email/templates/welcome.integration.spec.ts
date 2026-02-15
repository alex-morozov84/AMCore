/**
 * Integration test for Welcome Email Template
 *
 * Tests real React Email rendering without mocks.
 * Uses Vitest (React Email's official testing framework) with happy-dom.
 *
 * @see https://react.email/docs/introduction#testing
 */

import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'

import WelcomeEmail from './welcome'

describe('WelcomeEmail Template (Integration)', () => {
  it('should render in Russian by default', async () => {
    const html = await render(
      WelcomeEmail({
        name: 'Александр Морозов',
        email: 'alex@example.com',
      })
    )

    // Check that HTML is generated
    expect(html).toBeTruthy()
    expect(typeof html).toBe('string')

    // Check Russian content
    expect(html).toContain('Александр Морозов')
    expect(html).toContain('alex@example.com')
    expect(html).toContain('Добро пожаловать')
    expect(html).toContain('AMCore')

    // Check HTML structure
    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
    expect(html).toContain('<body')
  })

  it('should render in English when locale=en', async () => {
    const html = await render(
      WelcomeEmail({
        name: 'Alexander Morozov',
        email: 'alex@example.com',
        locale: 'en',
      })
    )

    // Check English content
    expect(html).toContain('Alexander Morozov')
    expect(html).toContain('Welcome')
    expect(html).toContain('Thank you for signing up')
    expect(html).toContain('Best regards')
  })

  it('should handle special characters in name', async () => {
    const html = await render(
      WelcomeEmail({
        name: 'Иван "Тест" Петров',
        email: 'ivan@example.com',
      })
    )

    expect(html).toContain('Иван')
    expect(html).toContain('Петров')
  })

  it('should include email info box', async () => {
    const html = await render(
      WelcomeEmail({
        name: 'Test User',
        email: 'test@example.com',
      })
    )

    // Email should be in info box
    expect(html).toContain('Email')
    expect(html).toContain('test@example.com')
  })

  it('should have proper HTML structure for email clients', async () => {
    const html = await render(
      WelcomeEmail({
        name: 'Test',
        email: 'test@example.com',
      })
    )

    // Tables for email client compatibility
    expect(html).toMatch(/<table/i)

    // Inline styles (email clients requirement)
    expect(html).toMatch(/style="/i)
  })
})
