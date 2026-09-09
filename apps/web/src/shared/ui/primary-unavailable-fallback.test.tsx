import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'

import { PrimaryUnavailableFallback } from './primary-unavailable-fallback'

const refresh = vi.fn()

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }))

const catalogues = { en, ru } as const

function renderFallback(
  reason: 'rate-limited' | 'timeout' | 'network' | 'upstream' = 'upstream',
  locale: keyof typeof catalogues = 'en'
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={catalogues[locale]}>
      <PrimaryUnavailableFallback reason={reason} />
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PrimaryUnavailableFallback', () => {
  it('renders the localized temporarily-unavailable message and retry control (en)', () => {
    renderFallback('upstream', 'en')

    expect(
      screen.getByText('This is temporarily unavailable. Please try again.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('renders the localized message in ru', () => {
    renderFallback('upstream', 'ru')

    expect(
      screen.getByText('Временно недоступно. Пожалуйста, попробуйте ещё раз.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })

  it('renders identical copy regardless of reason - a deliberate design choice, not a gap', () => {
    renderFallback('rate-limited')
    const rateLimited = screen.getByText('This is temporarily unavailable. Please try again.')

    renderFallback('network')
    const network = screen.getAllByText('This is temporarily unavailable. Please try again.')

    expect(rateLimited).toBeInTheDocument()
    expect(network).toHaveLength(2)
  })

  it('never renders the raw reason string to the user', () => {
    renderFallback('rate-limited')

    expect(screen.queryByText(/rate-limited/)).not.toBeInTheDocument()
  })

  it('calls router.refresh() when retry is clicked, not any other recovery mechanism', async () => {
    const user = userEvent.setup()
    renderFallback()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
