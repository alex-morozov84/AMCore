import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useScheduledJobs } from '../model/use-scheduled-jobs'

import {
  disabledJob,
  failedJob,
  frequentJob,
  notReportedJob,
  partialJob,
  response,
  succeededJob,
  unknownJob,
} from './scheduled-jobs-fixtures'
import { scheduledJobsMessages } from './scheduled-jobs-test-messages'
import { ScheduledJobsLive } from './ScheduledJobsLive'

vi.mock('../model/use-scheduled-jobs', () => ({ useScheduledJobs: vi.fn() }))
vi.mock('@/shared/ui/console-detail/ConsoleTimestamp', () => ({
  ConsoleTimestamp: ({ value }: { value: string }) => <time>{value}</time>,
}))
vi.mock('./ScheduledJobHistory', () => ({
  ScheduledJobHistory: ({ jobId }: { jobId: string }) => <p>history:{jobId}</p>,
}))

const setAuto = vi.fn()
const refresh = vi.fn()
function state(overrides: Partial<ReturnType<typeof useScheduledJobs>> = {}) {
  vi.mocked(useScheduledJobs).mockReturnValue({
    data: response([succeededJob, partialJob, unknownJob, disabledJob, frequentJob]),
    instance: 'i',
    reportAccessLoss: vi.fn(),
    denied: false,
    auto: true,
    setAuto,
    online: true,
    isFetching: false,
    refreshFailed: false,
    canRefresh: true,
    retryAfterSeconds: 0,
    refresh,
    ...overrides,
  })
}
function view() {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={scheduledJobsMessages}>
      <ScheduledJobsLive initial={response([])} initialUpdatedAt={0} />
    </NextIntlClientProvider>
  )
}
/** Desktop and mobile render the same rows; assert on the table, which assistive tech reads at md+. */
const table = () => screen.getByRole('table', { name: 'Scheduled jobs' })
const row = (name: string) =>
  within(table())
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryByText(name)) as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  state()
})

describe('result and freshness are separate facts', () => {
  it('shows a partly done job as overdue at the same time, with the steps and the due time', () => {
    view()
    const cells = within(row('Cleanup of old notifications')).getAllByRole('cell')
    expect(cells[2]).toHaveTextContent('Partly done')
    expect(cells[3]).toHaveTextContent('Overdue')
    expect(
      screen.getAllByText(/Some steps did not finish: expired sessions\./).length
    ).toBeGreaterThan(0)
    expect(screen.getAllByText(/A success was due by/).length).toBeGreaterThan(0)
  })

  it('says an unfinished run has no recorded end instead of "no runs yet"', () => {
    view()
    const cells = within(row('Cleanup of invitation records')).getAllByRole('cell')
    expect(cells[2]).toHaveTextContent('Result not recorded')
    expect(screen.getAllByText(/Its end was not recorded/).length).toBeGreaterThan(0)
  })

  it('shows a turned-off job with its reason and no result or freshness verdict', () => {
    view()
    const cells = within(row('GeoIP database update')).getAllByRole('cell')
    expect(cells[3]).toHaveTextContent('Turned off')
    expect(cells[2].textContent).not.toMatch(/Success|Failed|No runs yet/)
    expect(screen.getAllByText(/GeoIP is disabled/).length).toBeGreaterThan(0)
  })

  it('words a skip and the recorded failure code without exposing internal ids', () => {
    state({ data: response([frequentJob, failedJob]) })
    view()
    expect(
      screen.getAllByText(/Last skipped run \(all workers were busy\)/).length
    ).toBeGreaterThan(0)
    expect(screen.getAllByText(/Failed: All steps failed\./).length).toBeGreaterThan(0)
    expect(screen.queryByText(/all_buckets_failed/)).not.toBeInTheDocument()
  })

  it('names an unknown downstream job by its id', () => {
    state({ data: response([failedJob]) })
    view()
    expect(within(table()).getByText('downstream-report')).toBeInTheDocument()
  })
})

describe('schedule text', () => {
  it('reads cron expressions as words with the worker-reported time zone', () => {
    view()
    expect(
      within(row('Cleanup of expired records')).getByText('Daily at 02:00')
    ).toBeInTheDocument()
    expect(within(row('Cleanup of expired records')).getByText('UTC')).toBeInTheDocument()
    expect(within(row('Notification recovery')).getByText('Every 30 seconds')).toBeInTheDocument()
  })
})

describe('history and notes', () => {
  it('offers history only for daily jobs that are turned on', () => {
    view()
    expect(screen.getAllByText('history:cleanup').length).toBeGreaterThan(0)
    expect(screen.queryByText('history:geoip-update')).not.toBeInTheDocument()
    expect(screen.queryByText('history:notification-recovery')).not.toBeInTheDocument()
  })

  it('explains once, below the table, that frequent jobs do not track a current run', () => {
    view()
    expect(screen.getAllByText(/current run is not tracked/)).toHaveLength(1)
  })

  it('shows no footnote when no frequent job is listed', () => {
    state({ data: response([succeededJob]) })
    view()
    expect(screen.queryByText(/current run is not tracked/)).not.toBeInTheDocument()
  })
})

describe('data line and states', () => {
  it('tells the operator when nobody has reported the jobs', () => {
    state({ data: response([notReportedJob]) })
    view()
    expect(screen.getByText(/No worker has reported these jobs yet/)).toBeInTheDocument()
  })

  it('says the rows are older than now when a refresh failed, keeping the rows', () => {
    state({ refreshFailed: true })
    view()
    expect(screen.getByText(/Showing data from/)).toHaveTextContent('The last refresh failed.')
    expect(within(table()).getByText('Cleanup of expired records')).toBeInTheDocument()
  })

  it('hides all data after access is lost', () => {
    state({ data: null, denied: true })
    view()
    expect(screen.getByText(/access to this page changed/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('wires refresh and auto-refresh and blocks a refresh that is not allowed', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Auto-refresh on' }))
    expect(setAuto).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('disables refresh while offline-blocked and says when it is available again', () => {
    state({ canRefresh: false, retryAfterSeconds: 12 })
    view()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    expect(screen.getByText('Available in 12 seconds')).toBeInTheDocument()
  })
})
