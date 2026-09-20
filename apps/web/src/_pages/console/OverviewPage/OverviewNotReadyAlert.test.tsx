import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OverviewNotReadyAlert } from './OverviewNotReadyAlert'

const refresh = vi.fn()

vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh }),
}))

// Inline, English-only fixture of just the keys this component reads -
// deliberately not the real catalogue (`messages/en.json`), which is a
// locale-scaffold-tracked source file this single-locale-agnostic unit test
// has no reason to depend on.
const messages = {
  console: {
    overviewNotReadyTitle: 'API instance not ready',
    overviewNotReadyDependencies: 'Affected: {dependencies}',
    overviewRefresh: 'Refresh',
  },
}

function renderAlert(dependencies: { name: string; status: 'up' | 'down' | 'unknown' }[]) {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <OverviewNotReadyAlert dependencies={dependencies} />
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OverviewNotReadyAlert', () => {
  it('names only the sanitized failing dependencies, never the console itself', () => {
    renderAlert([
      { name: 'database', status: 'up' },
      { name: 'redis', status: 'down' },
    ])

    expect(screen.getByText('API instance not ready')).toBeInTheDocument()
    expect(screen.getByText('Affected: redis')).toBeInTheDocument()
    expect(screen.queryByText(/console/i)).not.toBeInTheDocument()
  })

  it('omits the affected-dependencies line when every dependency is up', () => {
    renderAlert([{ name: 'database', status: 'up' }])

    expect(screen.queryByText(/Affected:/)).not.toBeInTheDocument()
  })

  it('calls router.refresh() when the refresh control is clicked', async () => {
    const user = userEvent.setup()
    renderAlert([{ name: 'redis', status: 'down' }])

    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
