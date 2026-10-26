import { renderToString } from 'react-dom/server'
import {
  NextIntlClientProvider,
  useFormatter,
  useLocale,
  useNow,
  useTimeZone,
  useTranslations,
} from 'next-intl'
import { SUPPORTED_LOCALES } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ClientMessageProvider } from './client-message-provider'

function Content() {
  const common = useTranslations('common')
  const auth = useTranslations('auth')
  return (
    <p>
      {useLocale()}:{common('cancel')}:{auth('login')}
    </p>
  )
}

function Fixture({ locale }: { locale: (typeof SUPPORTED_LOCALES)[number] }) {
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone="UTC"
      messages={{ common: { cancel: 'shared' } }}
    >
      <ClientMessageProvider messages={{ auth: { login: 'selected' } }}>
        <Content />
      </ClientMessageProvider>
    </NextIntlClientProvider>
  )
}

describe('real nested message provider', () => {
  it('hydrates the actual server-rendered provider tree without mismatched messages', () => {
    const locale = SUPPORTED_LOCALES[0]
    const container = document.createElement('div')
    container.innerHTML = renderToString(<Fixture locale={locale} />)
    document.body.append(container)
    const errors = vi.spyOn(console, 'error')
    try {
      render(<Fixture locale={locale} />, { hydrate: true, container })
      expect(screen.getByText(`${locale}:shared:selected`)).toBeVisible()
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('inherits formats, time zone and clock independently from message additions', () => {
    const locale = SUPPORTED_LOCALES[0]
    const now = new Date('2026-01-02T03:04:05.000Z')
    const options = { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    function Probe() {
      const format = useFormatter()
      return (
        <p data-testid="format-probe">
          {useTimeZone()}:{useNow().toISOString()}:{format.number(1.5, 'precise')}
        </p>
      )
    }
    render(
      <NextIntlClientProvider
        locale={locale}
        timeZone="UTC"
        now={now}
        formats={{ number: { precise: options } }}
        messages={{ common: {} }}
      >
        <ClientMessageProvider messages={{ auth: {} }}>
          <Probe />
        </ClientMessageProvider>
      </NextIntlClientProvider>
    )
    expect(screen.getByTestId('format-probe')).toHaveTextContent(
      `UTC:${now.toISOString()}:${new Intl.NumberFormat(locale, options).format(1.5)}`
    )
  })

  it.each(SUPPORTED_LOCALES)('keeps the parent locale during %s server rendering', (locale) => {
    expect(renderToString(<Fixture locale={locale} />).replaceAll('<!-- -->', '')).toContain(
      `${locale}:shared:selected`
    )
  })

  it('uses the new parent locale without replacing the adapter boundary', () => {
    const first = SUPPORTED_LOCALES[0]
    const next = SUPPORTED_LOCALES.at(-1)!
    const { rerender } = render(<Fixture locale={first} />)
    expect(screen.getByText(`${first}:shared:selected`)).toBeVisible()
    rerender(<Fixture locale={next} />)
    expect(screen.getByText(`${next}:shared:selected`)).toBeVisible()
  })

  it('requires a parent instead of guessing locale or loading the full catalogue', () => {
    expect(() =>
      renderToString(
        <ClientMessageProvider messages={{ auth: {} }}>
          <span />
        </ClientMessageProvider>
      )
    ).toThrow()
  })

  it('preserves MISSING_MESSAGE diagnostics until a section selects its namespace', () => {
    const onError = vi.fn()
    const locale = SUPPORTED_LOCALES.at(-1)!
    function Section({ selected }: { selected: boolean }) {
      return (
        <NextIntlClientProvider
          locale={locale}
          timeZone="UTC"
          onError={onError}
          messages={{ common: { cancel: 'shared' } }}
        >
          <ClientMessageProvider messages={selected ? { auth: { login: 'selected' } } : {}}>
            <Content />
          </ClientMessageProvider>
        </NextIntlClientProvider>
      )
    }
    const { rerender } = render(<Section selected={false} />)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MISSING_MESSAGE', message: expect.stringContaining('auth') })
    )
    expect(onError.mock.calls[0][0].message).toContain(locale)
    onError.mockClear()
    rerender(<Section selected />)
    expect(screen.getByText(`${locale}:shared:selected`)).toBeVisible()
    expect(onError).not.toHaveBeenCalled()
  })
})
