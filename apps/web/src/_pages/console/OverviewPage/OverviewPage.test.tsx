import type { ReactElement } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin' }))

import { fetchConsoleOverview } from '@/shared/api/console/overview'

import { OverviewPage } from './OverviewPage'

vi.mock('@/shared/api/console/overview', () => ({ fetchConsoleOverview: vi.fn() }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: vi.fn() }),
}))

// Inline fixture of just the keys this page and its children read -
// deliberately not the real catalogues, which are locale-scaffold-tracked
// source files this test has no reason to depend on.
const consoleMessages = {
  title: 'Operations Console',
  overviewEyebrow: 'Control Room',
  overviewSubtitle: 'Status of the API instance answering this request',
  overviewVersionLabel: 'API version',
  overviewVersionHelp: 'help',
  overviewVersionUnknown: 'Unknown',
  overviewProcessRoleLabel: 'Process role',
  overviewProcessRoleHelp: 'help',
  overviewProcessRoleAll: 'API requests + background jobs',
  overviewProcessRoleWeb: 'API requests',
  overviewProcessRoleWorker: 'Background jobs',
  overviewDependenciesLabel: 'Dependencies',
  overviewDependencyLabelDatabase: 'Database',
  overviewDependencyLabelRedis: 'Cache (Redis)',
  overviewDependencyLabelDisk: 'Disk space',
  overviewDependencyLabelMemoryHeap: 'Memory',
  overviewDependencyLabelStorage: 'Storage',
  overviewDependencyStatusUp: 'Up',
  overviewDependencyStatusDown: 'Down',
  overviewDependencyStatusUnknown: 'Unknown',
  overviewNotReadyTitle: 'API instance not ready',
  overviewNotReadyDependencies: 'Affected: {dependencies}',
  overviewRefresh: 'Refresh',
}
const messages = {
  console: consoleMessages,
  common: {
    temporarilyUnavailable: 'This is temporarily unavailable. Please try again.',
    retry: 'Retry',
  },
}

// `OverviewPage`/`OverviewDetails` are Server Components calling
// `getTranslations` - mocked to read from the same fixture the client leaf
// components (`OverviewNotReadyAlert`, `PrimaryUnavailableFallback`) get via
// `NextIntlClientProvider`, so both layers render consistent, real text.
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string, values?: Record<string, unknown>) => {
    let text = (consoleMessages as Record<string, string>)[key] ?? key
    if (values) {
      for (const [name, value] of Object.entries(values)) {
        text = text.replace(`{${name}}`, String(value))
      }
    }
    return text
  }),
}))

function renderPage(page: ReactElement) {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      {page}
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OverviewPage', () => {
  it('renders the not-ready alert for an observed degraded instance, not the unavailable fallback', async () => {
    vi.mocked(fetchConsoleOverview).mockResolvedValue({
      status: 'success',
      data: {
        readiness: 'not_ready',
        dependencies: [{ name: 'redis', status: 'down' }],
        version: '1.0.0',
        processRole: 'all',
      },
    })

    renderPage(await OverviewPage())

    expect(screen.getByText('API instance not ready')).toBeInTheDocument()
    expect(
      screen.queryByText('This is temporarily unavailable. Please try again.')
    ).not.toBeInTheDocument()
  })

  it('renders the unavailable fallback for a real transport failure, not the not-ready alert', async () => {
    vi.mocked(fetchConsoleOverview).mockResolvedValue({
      status: 'unavailable',
      reason: 'timeout',
    })

    renderPage(await OverviewPage())

    expect(
      screen.getByText('This is temporarily unavailable. Please try again.')
    ).toBeInTheDocument()
    expect(screen.queryByText('API instance not ready')).not.toBeInTheDocument()
  })
})
