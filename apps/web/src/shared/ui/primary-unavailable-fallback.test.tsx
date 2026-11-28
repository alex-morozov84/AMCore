import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'

import { PrimaryUnavailableFallback } from './primary-unavailable-fallback'

const refresh = vi.fn()

vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh }),
}))

const catalogues = { en, ru } as const

function renderFallback(
  reason: 'rate-limited' | 'timeout' | 'network' | 'upstream' = 'upstream',
  locale: keyof typeof catalogues = 'en',
  onRetry?: () => void,
  retryAfterMs?: number
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={catalogues[locale]}>
      <PrimaryUnavailableFallback reason={reason} onRetry={onRetry} retryAfterMs={retryAfterMs} />
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

  it.each(['timeout', 'network', 'upstream'] as const)(
    'maps %s to approved generic copy without exposing the raw reason',
    (reason) => {
      const { container } = renderFallback(reason)

      expect(
        screen.getByText('This is temporarily unavailable. Please try again.')
      ).toBeInTheDocument()
      expect(container.innerHTML).not.toContain(reason)
    }
  )

  it.each([
    ['en', 7000, 'Too many requests. The server asks you to wait 7 seconds.'],
    ['ru', 7000, 'Слишком много запросов. Сервер просит подождать 7 секунд.'],
    ['ru', undefined, 'Слишком много запросов.'],
    ['ru', 0, 'Слишком много запросов.'],
  ] as const)('shows the rate limit in %s with delay %s', (locale, delay, message) => {
    renderFallback('rate-limited', locale, undefined, delay)
    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('calls router.refresh() when retry is clicked, not any other recovery mechanism', async () => {
    const user = userEvent.setup()
    renderFallback()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('calls the provided onRetry instead of router.refresh() when given', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderFallback('network', 'en', onRetry)

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
  })
})
