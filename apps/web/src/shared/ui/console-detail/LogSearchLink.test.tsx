import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LogSearchTargetProvider } from '@/shared/lib/log-search-context'
import { logSearchHref, type LogSearchTarget } from '@/shared/lib/log-search-link'

import { LogSearchLink, LogSearchNote } from './LogSearchLink'

const messages = {
  console: {
    logSearchLink: 'Find in logs',
    logSearchNote: 'Searches the last 7 days.',
    overviewPublicOpenNewTab: '(opens in a new tab)',
  },
}
const target: LogSearchTarget = {
  kind: 'grafana-loki',
  baseUrl: 'https://logs.example.com/grafana/',
}

function renderWith(node: React.ReactNode, value: LogSearchTarget | null) {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <LogSearchTargetProvider target={value}>{node}</LogSearchTargetProvider>
    </NextIntlClientProvider>
  )
}

describe('LogSearchLink', () => {
  it('opens the log search for the id in a new tab and says so to assistive technology', () => {
    renderWith(<LogSearchLink id="req-55" />, target)
    const link = screen.getByRole('link', { name: /Find in logs/ })
    expect(link).toHaveAttribute('href', logSearchHref(target, 'req-55'))
    expect(link).toHaveAccessibleName(/opens in a new tab/)
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders nothing without a configured address', () => {
    renderWith(<LogSearchLink id="req-55" />, null)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders nothing for an id that is not a well-formed correlation id', () => {
    renderWith(<LogSearchLink id={'x" } or {job=~".+'} />, target)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('LogSearchNote', () => {
  it('states what the links search, once, only when configured', () => {
    const { unmount } = renderWith(<LogSearchNote />, target)
    expect(screen.getByText('Searches the last 7 days.')).toBeInTheDocument()
    unmount()
    renderWith(<LogSearchNote />, null)
    expect(screen.queryByText('Searches the last 7 days.')).not.toBeInTheDocument()
  })
})
