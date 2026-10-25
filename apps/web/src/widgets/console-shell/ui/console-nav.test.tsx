import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'
import {
  getConsoleBackgroundWorkHref,
  getConsoleIntegrationsHref,
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
    integrations: { title: 'Integrations' },
    users: 'Users',
    organizations: 'Organizations',
    apiKeys: { title: 'API keys' },
    auditTitle: 'Audit',
    accountSecurity: 'Sign-in protection',
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
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      {node}
    </NextIntlClientProvider>
  )

beforeEach(() => pathname.mockReturnValue('/admin'))

describe('Console navigation', () => {
  it('lists nine sections with Scheduled jobs after Background work and Integrations before Users', () => {
    inProvider(<Items />)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Overview',
      'Background work',
      'Scheduled jobs',
      'Integrations',
      'Users',
      'Organizations',
      'API keys',
      'Sign-in protection',
      'Audit',
    ])
  })

  it('names the page in the breadcrumb on the Scheduled jobs route only', () => {
    pathname.mockReturnValue(getConsoleScheduledJobsHref())
    inProvider(<ConsoleBreadcrumb />)
    expect(screen.getByText('OPS / Scheduled jobs')).toBeInTheDocument()
  })

  it('names the page in the breadcrumb on the Integrations route', () => {
    pathname.mockReturnValue(getConsoleIntegrationsHref())
    inProvider(<ConsoleBreadcrumb />)
    expect(screen.getByText('OPS / Integrations')).toBeInTheDocument()
  })

  it('keeps the Background work breadcrumb for its own route', () => {
    pathname.mockReturnValue(getConsoleBackgroundWorkHref())
    inProvider(<ConsoleBreadcrumb />)
    expect(screen.getByText('OPS / Background work')).toBeInTheDocument()
    expect(screen.queryByText(/Scheduled jobs/)).not.toBeInTheDocument()
  })
})

const mutableConfig = ADMIN_CONSOLE_CONFIG as unknown as { mode: string; slug: string }
const originalConfig = { ...mutableConfig }
afterEach(() => Object.assign(mutableConfig, originalConfig))
it('hydrates rewritten host navigation with stable fallback before selecting the browser page', async () => {
  mutableConfig.mode = 'host'
  mutableConfig.slug = 'control'
  pathname.mockReturnValue('/control')
  const tree = () => (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <ConsoleBreadcrumb />
    </NextIntlClientProvider>
  )
  const container = document.createElement('div')
  container.innerHTML = renderToString(tree())
  expect(container.textContent).toBe('OPS')
  document.body.append(container)
  pathname.mockReturnValue('/')
  const recover = vi.fn()
  let root!: ReturnType<typeof hydrateRoot>
  await act(async () => {
    root = hydrateRoot(container, tree(), { onRecoverableError: recover })
  })
  expect(container.textContent).toBe('OPS / Overview')
  expect(recover).not.toHaveBeenCalled()
  await act(async () => root.unmount())
  container.remove()
})
