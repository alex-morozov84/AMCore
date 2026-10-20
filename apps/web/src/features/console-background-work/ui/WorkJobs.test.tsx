import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE, type WorkJob, type WorkSummary } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { consoleApi } from '@/shared/api/console-api'
import { LogSearchTargetProvider } from '@/shared/lib/log-search-context'
import { logSearchHref, type LogSearchTarget } from '@/shared/lib/log-search-link'

// Local behavior fixture stays usable after locale scaffolding removes a catalogue.
const messages = {
  console: {
    backgroundWork: {
      control: {
        allFilter: 'All',
        searchLabel: 'Search by job ID',
        searchClear: 'Clear job search',
        searchHelp: 'Searches the latest 512 jobs in the selected list.',
        projectionYes: 'Yes',
        projectionNo: 'No',
        technicalDetails: 'Technical details',
        historyTitle: 'Attempt history',
        historyEmpty: 'No retained attempts.',
        failureTitle: 'Reason for failure',
        failureNextStep: 'What to do:',
        failureUnavailable: 'Detailed reason unavailable.',
        jobsTitle: 'Jobs \u00b7 {work}',
        refresh: 'Refresh work state',
        sources: {
          broker: 'Queue jobs',
          PG_evidence: 'Retained provider safety evidence',
        },
        jobStates: {
          failed: 'Failed',
          waiting: 'Waiting',
          active: 'Active',
          delayed: 'Delayed',
          prioritized: 'Prioritized',
          completed: 'Completed',
          missing: 'History unavailable',
          unavailable: 'Broker execution state not observed',
        },
        evidenceMeaning:
          'These independent records survive queue history removal and reused job IDs. Queue state and completed attempts are not observed here. A record does not establish success or authorize another call.',
        windowTruncated:
          'This is a bounded live window. Additional jobs or unavailable rows may be outside this view.',
        loadingJobs: 'Loading jobs\u2026',
        noJobs: 'No jobs in this window.',
        incarnation: 'Execution identity: {id}',
        separator: ' \u00b7 ',
        attempts:
          'Started: {started} \u00b7 Finished attempts: {made} \u00b7 Manual grant: {grant}',
        notDisplayed: 'not observed',
        grants: {
          none: 'unused',
          reserved: 'reserved',
          spent: 'spent',
        },
        certainty: {
          none: 'No external effect recorded',
          accepted: 'External effect accepted',
          unknown: 'External effect is uncertain',
        },
        unavailableActions: 'Unavailable actions:',
        noSelectedActions:
          '{count, plural, one {No actions are available for the selected job} other {No actions are available for the selected jobs}}',
        actionReasons: {
          uncertain: 'The previous outcome is unknown.',
          unknown: 'The previous outcome is unknown.',
          active: 'The job is running or has already started.',
          started: 'Only a job that has never started can be cancelled.',
          changed: 'Refresh the data to check action availability.',
        },
        certaintyHelp: {
          none: 'No request accepted.',
          accepted: 'Acceptance does not guarantee delivery.',
          unknown: 'The result is unknown.',
        },
        actions: {
          pause: 'Pause',
          resume: 'Resume',
          retry: 'Retry',
          cancel: 'Cancel',
          cleanup: 'Clean up',
        },
        selectionFrozen:
          'Selection retains the observed identities and revisions. Refresh does not replace it; the server rejects stale targets.',
        previous: 'Previous',
        next: 'Next',
        page: 'Page {page}',
      },
    },
  },
  errors: {
    ACTIVE_JOB: 'This job is already running or has started. The requested action is unavailable.',
    READ_LIMIT: 'The bounded read limit was reached. Narrow the selection or read a smaller page.',
  },
}

import { WorkJobs } from './WorkJobs'

vi.mock('@/shared/ui/route-progress-link', () => ({ RouteProgressLink: 'a' }))

vi.mock('@/shared/api/console-api', () => ({
  consoleApi: { getBackgroundWorkJobs: vi.fn(), getBackgroundWorkJob: vi.fn() },
}))

const work: WorkSummary = {
  id: 'image',
  kind: 'ordinary',
  status: 'available',
  definitionVersion: 2,
  sampledAt: new Date().toISOString(),
  revision: 'a'.repeat(64),
  capabilities: [],
}
const job: WorkJob = {
  identity: {
    id: 'job_1',
    incarnation: '019a1234-1234-7123-8123-123456789012',
    revision: 'b'.repeat(64),
  },
  state: 'failed',
  jobName: 'render',
  wireVersion: 2,
  sampledAt: work.sampledAt,
  source: 'broker',
  replay: 'idempotent',
  attemptsStarted: 1,
  attemptsMade: 1,
  manualGrant: 'none',
  projection: { businessRequestId: 'source' },
  capabilities: [
    { operation: 'retry', allowed: true },
    { operation: 'cancel', allowed: false, reason: 'ACTIVE_JOB' },
  ],
}

let queryClient: QueryClient

function view(current = work, target: LogSearchTarget | null = null) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const capture = vi.fn()
  render(
    <NextIntlClientProvider
      locale={DEFAULT_LOCALE}
      timeZone="UTC"
      messages={{
        console: {
          backgroundWork: messages.console.backgroundWork,
          logSearchLink: 'Find in logs',
          overviewPublicOpenNewTab: '(opens in a new tab)',
        },
        errors: messages.errors,
      }}
    >
      <QueryClientProvider client={queryClient}>
        <LogSearchTargetProvider target={target}>
          <WorkJobs work={current} blocked={false} onCapture={capture} />
        </LogSearchTargetProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
  return capture
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(consoleApi.getBackgroundWorkJobs).mockResolvedValue({
    workId: work.id,
    sampledAt: work.sampledAt,
    rows: [structuredClone(job)],
    windowTruncated: false,
  })
})

describe('native registered job selection', () => {
  it('keeps the selected revision after live refresh and honors each observed capability', async () => {
    const capture = view()
    const checkbox = await screen.findByRole('checkbox', { name: 'job_1' })
    fireEvent.click(checkbox)
    expect(screen.getByRole('button', { name: 'Cancel · 1' })).toBeDisabled()
    vi.mocked(consoleApi.getBackgroundWorkJobs).mockResolvedValue({
      workId: work.id,
      sampledAt: work.sampledAt,
      rows: [{ ...job, identity: { ...job.identity, revision: 'c'.repeat(64) } }],
      windowTruncated: false,
    })
    await queryClient.refetchQueries({ queryKey: ['console', 'background-work', 'jobs'] })
    await waitFor(() => expect(consoleApi.getBackgroundWorkJobs).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Retry · 1' }))
    expect(capture.mock.calls[0]?.[1][0].identity.revision).toBe(job.identity.revision)
  })

  it('does not repeat the selected state and replaces an entirely ineligible action bar', async () => {
    vi.mocked(consoleApi.getBackgroundWorkJobs).mockResolvedValue({
      workId: work.id,
      sampledAt: work.sampledAt,
      windowTruncated: false,
      rows: [
        {
          ...job,
          capabilities: (['retry', 'cancel', 'cleanup'] as const).map((operation) => ({
            operation,
            allowed: false,
            reason: 'ACTIVE_JOB',
          })),
        },
      ],
    })
    view()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'job_1' }))
    expect(screen.getAllByText('Failed')).toHaveLength(1)
    expect(screen.getByText('Unavailable actions:')).toBeInTheDocument()
    expect(screen.getByText('No actions are available for the selected job')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry · 1' })).not.toBeInTheDocument()
  })

  it('uses registration-owned field labels without changing projected values', async () => {
    view({
      ...work,
      presentation: {
        name: { en: 'Image processing' },
        fields: { businessRequestId: { en: 'Processing request' } },
      },
    })
    await screen.findByRole('checkbox', { name: 'job_1' })
    expect(screen.getByText('Processing request')).toBeInTheDocument()
    expect(screen.getByText('source')).toBeInTheDocument()
    expect(screen.queryByText('businessRequestId')).not.toBeInTheDocument()
  })

  it('shows truncated/unavailable reads explicitly rather than an empty healthy state', async () => {
    vi.mocked(consoleApi.getBackgroundWorkJobs).mockResolvedValue({
      workId: work.id,
      sampledAt: work.sampledAt,
      rows: [],
      windowTruncated: true,
      reason: 'READ_LIMIT',
    })
    view()
    expect(
      await screen.findByText(messages.console.backgroundWork.control.windowTruncated)
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry · 0' })).not.toBeInTheDocument()
  })

  it('opens independent safety evidence during a broker outage without inventing completed attempts', async () => {
    vi.mocked(consoleApi.getBackgroundWorkJobs).mockResolvedValue({
      workId: work.id,
      sampledAt: work.sampledAt,
      windowTruncated: false,
      rows: [
        {
          ...job,
          attemptsMade: undefined,
          state: 'unavailable',
          source: 'PG_evidence',
          replay: 'provider-window',
          certainty: 'unknown',
          capabilities: job.capabilities.map((item) => ({ ...item, allowed: false })),
        },
      ],
    })
    view({ ...work, status: 'unavailable', providerEvidence: true })
    await screen.findByText(messages.console.backgroundWork.control.evidenceMeaning)
    expect(consoleApi.getBackgroundWorkJobs).toHaveBeenCalledWith(
      work.id,
      expect.objectContaining({ source: 'PG_evidence' }),
      expect.any(AbortSignal)
    )
    expect(await screen.findByRole('checkbox', { name: 'job_1' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(
      screen.getByText(messages.console.backgroundWork.control.jobStates.unavailable, {
        exact: false,
      })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Failed' })).not.toBeInTheDocument()
    expect(screen.getAllByText(/not observed/).length).toBeGreaterThan(0)
  })
})

describe('find in logs', () => {
  const target: LogSearchTarget = { kind: 'grafana-loki', baseUrl: 'http://localhost:3002/' }

  it('links each job id to the log search, beside the selection control and not inside it', async () => {
    view(work, target)
    const link = await screen.findByRole('link', { name: /Find in logs/ })
    expect(link).toHaveAttribute('href', logSearchHref(target, 'job_1'))
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link.closest('label')).toBeNull()
    const checkbox = screen.getByRole('checkbox', { name: 'job_1' })
    fireEvent.click(link)
    expect(checkbox).not.toBeChecked()
  })

  it('shows no link when the log-search address is not configured', async () => {
    view()
    await screen.findByRole('checkbox', { name: 'job_1' })
    expect(screen.queryByRole('link', { name: /Find in logs/ })).not.toBeInTheDocument()
  })
})

describe('registered filters and lazy history', () => {
  it('renders readable booleans and omits empty technical disclosures', async () => {
    vi.mocked(consoleApi.getBackgroundWorkJobs).mockResolvedValue({
      workId: work.id,
      sampledAt: work.sampledAt,
      windowTruncated: false,
      rows: [{ ...job, projection: { unresolved: false, reference: '', generation: '' } }],
    })
    view({
      ...work,
      presentation: {
        name: { en: 'Delivery' },
        fields: {
          unresolved: { en: 'Unconfirmed attempts' },
          reference: { en: 'Reference' },
          generation: { en: 'Generation' },
        },
        technicalFields: ['reference', 'generation'],
      },
    })
    await screen.findByRole('checkbox', { name: 'job_1' })
    expect(screen.getByText('No', { exact: true })).toBeInTheDocument()
    expect(screen.queryByText('false', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Technical details')).not.toBeInTheDocument()
  })
  it('debounces search with the selected status and resets captured selection; clear refocuses', async () => {
    view()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'job_1' }))
    const field = screen.getByRole('textbox', { name: 'Search by job ID' })
    fireEvent.change(field, { target: { value: ' job_1 ' } })
    expect(screen.queryByRole('button', { name: /^Search$/ })).not.toBeInTheDocument()
    expect(consoleApi.getBackgroundWorkJobs).not.toHaveBeenLastCalledWith(
      work.id,
      expect.objectContaining({ search: 'job_1' }),
      expect.any(AbortSignal)
    )
    await waitFor(() =>
      expect(consoleApi.getBackgroundWorkJobs).toHaveBeenLastCalledWith(
        work.id,
        expect.objectContaining({ state: 'failed', search: 'job_1', page: 1 }),
        expect.any(AbortSignal)
      )
    )
    expect(screen.queryByRole('button', { name: 'Retry · 1' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear job search' }))
    expect(field).toHaveFocus()
    await waitFor(() =>
      expect(consoleApi.getBackgroundWorkJobs).toHaveBeenLastCalledWith(
        work.id,
        expect.objectContaining({ search: undefined, page: 1 }),
        expect.any(AbortSignal)
      )
    )
  })
  const presented: WorkSummary = {
    ...work,
    kind: 'durable',
    presentation: {
      name: { en: 'Delivery fixture' },
      fields: {},
      attemptHistory: true,
      filters: [
        {
          key: 'channel',
          label: { en: 'Channel' },
          options: [{ value: 'telegram', label: { en: 'Telegram' } }],
        },
      ],
    },
  }

  it('does not fetch history for rows until opened and keeps only one open', async () => {
    const second = {
      ...job,
      identity: {
        ...job.identity,
        id: 'job_2',
        incarnation: '019a1234-1234-7123-8123-123456789013',
      },
    }
    vi.mocked(consoleApi.getBackgroundWorkJobs).mockResolvedValue({
      workId: work.id,
      sampledAt: work.sampledAt,
      rows: [job, second],
      windowTruncated: false,
    })
    vi.mocked(consoleApi.getBackgroundWorkJob).mockImplementation(async (_work, id) => ({
      ...(id === 'job_1' ? job : second),
      history: { attempts: [], historyTruncated: false, historyExpired: false },
    }))
    view(presented)
    await screen.findByRole('checkbox', { name: 'job_2' })
    expect(consoleApi.getBackgroundWorkJob).not.toHaveBeenCalled()
    const summaries = screen.getAllByText('Attempt history')
    const details0 = summaries[0]!.closest('details')!
    details0.open = true
    fireEvent(details0, new Event('toggle'))
    await waitFor(() => expect(consoleApi.getBackgroundWorkJob).toHaveBeenCalledTimes(1))
    const details1 = summaries[1]!.closest('details')!
    details1.open = true
    fireEvent(details1, new Event('toggle'))
    await waitFor(() => expect(consoleApi.getBackgroundWorkJob).toHaveBeenCalledTimes(2))
    expect(summaries[0]!.closest('details')).not.toHaveAttribute('open')
    expect(summaries[1]!.closest('details')).toHaveAttribute('open')
  })

  it('resets selection and page when a registered filter changes', async () => {
    const capture = view(presented)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'job_1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Telegram' }))
    await waitFor(() =>
      expect(consoleApi.getBackgroundWorkJobs).toHaveBeenLastCalledWith(
        work.id,
        expect.objectContaining({ page: 1, filters: { channel: 'telegram' } }),
        expect.any(AbortSignal)
      )
    )
    expect(screen.queryByRole('button', { name: 'Retry · 1' })).not.toBeInTheDocument()
    expect(capture).not.toHaveBeenCalled()
  })
})
