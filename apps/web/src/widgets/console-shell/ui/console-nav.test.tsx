import { NextIntlClientProvider } from 'next-intl'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getConsoleBackgroundWorkHref,
  getConsoleScheduledJobsHref,
} from '@/shared/lib/console-public-href'

import { useConsoleNavItems } from './console-nav-items'
import { ConsoleBreadcrumb } from './ConsoleBreadcrumb'

const pathname = vi.fn<() => string>()
vi.mock('@/i18n/navigation', () => ({ usePathname: () => pathname() }))

// Inline fixture of the keys these components read: the real catalogues are locale-scaffold files.
const messages = {
  console: {
    opsPrefix: 'OPS',
    overview: 'Overview',
    backgroundWork: { title: 'Background work' },
    scheduledJobs: { title: 'Scheduled jobs' },
    users: 'Users',
    organizations: 'Organizations',
    apiKeys: { title: 'API keys' },
    auditTitle: 'Audit',
  },
}

function Items() {
  return (
    <ol>
      {useConsoleNavItems().map((item) => (
        <li key={item.href}>{item.label}</li>
      ))}
    </ol>
  )
}
const inProvider = (node: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>
  )

beforeEach(() => pathname.mockReturnValue('/admin'))

describe('Console navigation', () => {
  it('lists seven sections with Scheduled jobs right after Background work', () => {
    inProvider(<Items />)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Overview',
      'Background work',
      'Scheduled jobs',
      'Users',
      'Organizations',
      'API keys',
      'Audit',
    ])
  })

  it('names the page in the breadcrumb on the Scheduled jobs route only', () => {
    pathname.mockReturnValue(getConsoleScheduledJobsHref())
    inProvider(<ConsoleBreadcrumb />)
    expect(screen.getByText('OPS / Scheduled jobs')).toBeInTheDocument()
  })

  it('keeps the Background work breadcrumb for its own route', () => {
    pathname.mockReturnValue(getConsoleBackgroundWorkHref())
    inProvider(<ConsoleBreadcrumb />)
    expect(screen.getByText('OPS / Background work')).toBeInTheDocument()
    expect(screen.queryByText(/Scheduled jobs/)).not.toBeInTheDocument()
  })
})
