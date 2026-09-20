import { NextIntlClientProvider } from 'next-intl'
import type * as AmcoreShared from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleLocaleSwitcher } from './ConsoleLocaleSwitcher'

const replace = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/organizations',
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('page=2'),
}))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ replace }),
}))

// Inline fixture of just the `locale` namespace keys this component reads -
// deliberately not the real catalogues (`messages/en.json`/`ru.json`), which
// are locale-scaffold-tracked source files this single-locale-agnostic unit
// test has no reason to depend on.
const messages = { locale: { label: 'Language', en: 'English', ru: 'Русский' } }

function renderSwitcher() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ConsoleLocaleSwitcher />
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ConsoleLocaleSwitcher', () => {
  it('renders every supported locale as an option', () => {
    renderSwitcher()

    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Русский' })).toBeInTheDocument()
  })

  it('navigates to the same pathname and query with the new locale, never the raw next/navigation router', async () => {
    const user = userEvent.setup()
    renderSwitcher()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ru')

    expect(replace).toHaveBeenCalledWith(
      { pathname: '/admin/organizations', query: { page: '2' } },
      { locale: 'ru' }
    )
  })

  it('does nothing when selecting the already-active locale', async () => {
    const user = userEvent.setup()
    renderSwitcher()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'en')

    expect(replace).not.toHaveBeenCalled()
  })
})

describe('ConsoleLocaleSwitcher (single-locale fork)', () => {
  it('renders nothing when only one locale is supported', async () => {
    vi.resetModules()
    vi.doMock('@amcore/shared', async (importOriginal) => {
      const actual = await importOriginal<typeof AmcoreShared>()
      return { ...actual, SUPPORTED_LOCALES: ['en'] }
    })

    const { ConsoleLocaleSwitcher: SingleLocaleSwitcher } = await import('./ConsoleLocaleSwitcher')

    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SingleLocaleSwitcher />
      </NextIntlClientProvider>
    )

    expect(container).toBeEmptyDOMElement()

    vi.doUnmock('@amcore/shared')
  })
})
