import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
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
