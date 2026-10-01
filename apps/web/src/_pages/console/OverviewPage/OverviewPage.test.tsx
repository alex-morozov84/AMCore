import type { ReactElement } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as DeploymentIdentity from '@/shared/lib/deployment-version/identity'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/deployment-version/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof DeploymentIdentity>()),
  DEPLOYMENT_VERSION: 'web-artifact-123',
}))
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin' }))

import { fetchConsoleOverview } from '@/shared/api/console/overview'
import { BackendRequestError } from '@/shared/api/server/errors'

import { overviewFixture } from './overview-fixture'
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
  overviewWebTitle: 'Web artifact',
  overviewPoolTitle: 'Local database pool',
  overviewMemoryTitle: 'API process memory',
  overviewDiskTitle: 'API root filesystem',
  overviewMiB: '{value} MiB',
  overviewBytes: '{value} {unit}',
  overviewUnitMB: 'MB',
  overviewUnitGB: 'GB',
  overviewUnitTB: 'TB',
  overviewFilesHealthy: 'Working',
  overviewFilesCostTitle: 'S3 checks consume billable requests',
  overviewFilesWaiting: 'Waiting for the current check to finish',
  overviewAbove: 'Above {value}',
  overviewSeconds: '{value} s',
  overviewMeasurementUnavailable: 'Measurement unavailable',
  overviewStorageNotConfigured: 'Probe not configured',
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
  overviewDependencyStatusDegraded: 'Degraded',
  overviewDegradedNotice: 'The API reports degraded readiness.',
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
  getFormatter: vi.fn().mockResolvedValue({
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', options).format(value),
  }),
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
    <NextIntlClientProvider locale={DEFAULT_LOCALE} timeZone="UTC" messages={messages}>
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
        ...overviewFixture,
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

  it('renders fulfilled degraded readiness without claiming not-ready or unavailable', async () => {
    vi.mocked(fetchConsoleOverview).mockResolvedValue({
      status: 'success',
      data: {
        ...overviewFixture,
        readiness: 'degraded',
        dependencies: [{ name: 'redis', status: 'degraded' }],
        version: '1.0.0',
        processRole: 'all',
      },
    })

    renderPage(await OverviewPage())

    expect(screen.getByText('The API reports degraded readiness.')).toBeInTheDocument()
    expect(screen.getAllByText('Degraded')).toHaveLength(2)
    expect(screen.queryByText('API instance not ready')).not.toBeInTheDocument()
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
    expect(screen.getByText('web-artifact-123')).toBeInTheDocument()
  })

  it('propagates malformed 2xx contract errors to the route error boundary', async () => {
    const error = new BackendRequestError('invalid-payload', 'test-correlation', 200)
    vi.mocked(fetchConsoleOverview).mockRejectedValue(error)
    await expect(OverviewPage()).rejects.toBe(error)
  })

  it('retains pool and memory when the filesystem sample is unavailable', async () => {
    vi.mocked(fetchConsoleOverview).mockResolvedValue({
      status: 'success',
      data: {
        ...overviewFixture,
        resources: {
          ...overviewFixture.resources,
          filesystem: { status: 'unavailable', sampledAt: null },
        },
      },
    })
    renderPage(await OverviewPage())
    expect(screen.getByText('Measurement unavailable')).toBeInTheDocument()
    expect(screen.getByText('134.2 MB')).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.queryByText('Probe not configured')).not.toBeInTheDocument()
  })
  it('shows server schedule and warns about S3 costs only for S3', async () => {
    vi.mocked(fetchConsoleOverview).mockResolvedValue({
      status: 'success',
      data: { ...overviewFixture, storage: { ...overviewFixture.storage, driver: 's3' } },
    })
    const { container, unmount } = renderPage(await OverviewPage())
    expect(screen.getByText('S3 checks consume billable requests')).toBeInTheDocument()
    expect(
      container.querySelector(`time[datetime="${overviewFixture.storage.nextScheduledAt}"]`)
    ).toBeInTheDocument()
    unmount()
    vi.mocked(fetchConsoleOverview).mockResolvedValue({
      status: 'success',
      data: {
        ...overviewFixture,
        storage: {
          ...overviewFixture.storage,
          driver: 'local',
          inProgress: true,
          nextScheduledAt: null,
        },
      },
    })
    renderPage(await OverviewPage())
    expect(screen.queryByText('S3 checks consume billable requests')).not.toBeInTheDocument()
    expect(screen.getByText(/Waiting for the current check to finish/)).toBeInTheDocument()
  })
})
