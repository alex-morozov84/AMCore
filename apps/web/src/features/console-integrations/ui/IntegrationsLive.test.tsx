import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE, type IntegrationItem } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useIntegrations } from '../model/use-integrations'

import {
  custom,
  item,
  oauthConfigOnly,
  READ_AT,
  response,
  storageFailedStale,
  unreadable,
} from './integrations-fixtures'
import { integrationsMessages } from './integrations-test-messages'
import { IntegrationsLive } from './IntegrationsLive'

vi.mock('../model/use-integrations', () => ({ useIntegrations: vi.fn() }))
vi.mock('@/shared/ui/console-detail/ConsoleTimestamp', () => ({
  ConsoleTimestamp: ({ value }: { value: string }) => <time>{value}</time>,
}))
vi.mock('@/shared/ui/route-progress-link', () => ({
  RouteProgressLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('./ProbeAction', () => ({ ProbeAction: () => null }))
vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
vi.setSystemTime(new Date(READ_AT))

function state(overrides: Partial<ReturnType<typeof useIntegrations>> = {}) {
  vi.mocked(useIntegrations).mockReturnValue({
    data: response([item(), storageFailedStale, oauthConfigOnly, unreadable, custom]),
    reportAccessLoss: vi.fn(),
    denied: false,
    auto: true,
    setAuto: vi.fn(),
    online: true,
    isFetching: false,
    refreshFailed: false,
    canRefresh: true,
    retryAfterSeconds: 0,
    refresh: vi.fn(),
    ...overrides,
  })
}
function view() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={integrationsMessages}>
        <IntegrationsLive initial={response([])} initialUpdatedAt={0} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}
const table = () => screen.getByRole('table', { name: 'Integrations' })
const row = (name: string) =>
  within(table())
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryByText(name)) as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  state()
})

describe('setup, result and age are separate facts', () => {
  it('keeps a failed result failed when it is old, and names the safe reason and scope', () => {
    view()
    const cells = within(row('Files')).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('Failed')
    expect(cells[2]).toHaveTextContent('Set up')
    expect(cells[3]).toHaveTextContent('Failed, old')
    expect(cells[3]).toHaveTextContent('access denied')
    expect(cells[3]).toHaveTextContent('this server')
    expect(cells[3]).toHaveTextContent('Writes, reads and deletes a test file')
  })

  it('says "No stored result" for an email row without evidence, never "Working"', () => {
    view()
    const cells = within(row('Email')).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('Set up, not verified')
    expect(cells[3]).toHaveTextContent('No stored result')
    expect(screen.queryByText(/Working/)).not.toBeInTheDocument()
  })

  it('shows a configuration-only row as not verified, with no check time', () => {
    view()
    const cells = within(row('Sign-in providers')).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('Set up, not verified')
    expect(cells[3]).toHaveTextContent('Not verified')
    expect(cells[3]).toHaveTextContent('Configuration only')
    expect(within(cells[3]!).queryByRole('time')).not.toBeInTheDocument()
  })

  it('shows an unreadable source as "Cannot read" without hiding the other rows', () => {
    view()
    expect(within(row('Queue')).getAllByText('Cannot read').length).toBeGreaterThan(0)
    expect(row('Files')).toBeDefined()
  })
})

describe('the scope text does not claim an acceptance that was not observed (C7)', () => {
  it.each([
    ['none', { result: 'none', freshness: 'none', checkedAt: null }],
    ['simulated', { result: 'simulated', freshness: 'fresh' }],
    ['refused', { result: 'failed', freshness: 'fresh', failure: 'auth' }],
    ['unknown', { result: 'unknown', freshness: 'fresh' }],
  ] as const)('for a %s email result', (_name, over) => {
    const base = item()
    state({
      data: response([
        {
          ...base,
          evidence: { ...base.evidence, checkedAt: '2026-10-22T11:59:00.000Z', ...over },
        },
      ]),
    })
    view()
    expect(
      screen.getAllByText(/A direct send from the API server to the provider/).length
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/provider accepted a direct send/i)).not.toBeInTheDocument()
  })
})

describe('the Telegram check row', () => {
  const telegram = (
    over: Partial<IntegrationItem['evidence']>,
    facts: IntegrationItem['facts']
  ) => {
    const base = item()
    return {
      ...base,
      id: 'telegram',
      name: 'Telegram',
      action: null,
      facts,
      links: ['runbook' as const],
      evidence: {
        ...base.evidence,
        scope: 'provider_token_check' as const,
        instance: 'workers' as const,
        checkedAt: '2026-10-22T11:59:00.000Z',
        staleAfterSeconds: 210,
        ...over,
      },
    }
  }

  it('says "Check passed", not "Working", and states what the check does not cover', () => {
    const facts = [
      { key: 'workers_reporting', value: 2 },
      { key: 'interval_seconds', value: 60 },
    ]
    state({
      data: response([telegram({ result: 'ok', freshness: 'fresh', failure: null }, facts)]),
    })
    view()
    const cells = within(row('Telegram')).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('Check passed')
    expect(cells[1]).toHaveTextContent('Workers reporting: 2')
    expect(cells[1]).toHaveTextContent('Checked every 60 s')
    expect(cells[3]).toHaveTextContent('Confirmed')
    expect(cells[3]).toHaveTextContent('workers')
    expect(cells[3]).toHaveTextContent('Message delivery and incoming messages are not checked.')
    expect(screen.queryByText(/Working/)).not.toBeInTheDocument()
  })

  it('uses the row-specific reason, right under the result, before the time and scope', () => {
    const facts = [
      { key: 'workers_reporting', value: 1 },
      { key: 'workers_failed', value: 1 },
    ]
    state({
      data: response([
        telegram({ result: 'failed', freshness: 'fresh', failure: 'unreachable' }, facts),
      ]),
    })
    view()
    const cell = within(row('Telegram')).getAllByRole('cell')[3]!
    const reason = within(cell).getByText('the server cannot reach Telegram')
    expect(within(cell).queryByText('no queue answered')).not.toBeInTheDocument()
    const lines = [...cell.querySelectorAll('p')].map((p) => p.textContent)
    expect(lines.indexOf(reason.textContent)).toBe(1)
    expect(reason.className).toContain('text-danger')
  })
})

describe('registered integrations need no page change', () => {
  it('renders a downstream integration with its registered name and a readable fact', () => {
    view()
    const cells = within(row('CRM sync')).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('open tickets: 4')
  })

  it('reports an empty registry', () => {
    state({ data: response([]) })
    view()
    expect(screen.getByText('No integrations are registered.')).toBeInTheDocument()
  })
})

describe('ageing and reading honesty', () => {
  it('labels the read time and keeps old rows visible with a warning after a failed refresh', () => {
    state({ refreshFailed: true })
    view()
    expect(screen.getByRole('status')).toHaveTextContent('Showing data from')
    expect(screen.getByRole('status')).toHaveTextContent('The last refresh failed.')
    expect(row('Files')).toBeDefined()
  })

  it('hides every row and says why after access is lost', () => {
    state({ data: null, denied: true })
    view()
    expect(
      screen.getByText('Your access to this page changed. The data is hidden.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('offers the setup caveat under the list', () => {
    view()
    expect(screen.getByText(/does not prove that they work/)).toBeInTheDocument()
  })
})
