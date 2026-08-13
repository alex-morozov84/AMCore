import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import en from '../../../../../messages/en.json'

import { OAuthSection } from './OAuthSection'

function renderSection(providers: string[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <OAuthSection providers={providers} />
    </NextIntlClientProvider>
  )
}

describe('OAuthSection', () => {
  it('renders a Google sign-in link to the relative BFF init route when configured', () => {
    renderSection(['google'])

    const link = screen.getByRole('link', { name: 'Continue with Google' })
    expect(link).toHaveAttribute('href', '/api/auth/oauth/google')
  })

  it('renders nothing when google is not in the configured providers', () => {
    const { container } = renderSection(['apple'])
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when no providers are configured at all', () => {
    const { container } = renderSection([])
    expect(container).toBeEmptyDOMElement()
  })
})
