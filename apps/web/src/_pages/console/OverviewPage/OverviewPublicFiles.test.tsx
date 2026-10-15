import type { AdminOverviewPublicDelivery } from '@amcore/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { OverviewTranslations } from './overview-types'
import {
  OverviewExposureBanner,
  OverviewPublicConfig,
  OverviewPublicState,
} from './OverviewPublicFiles'

vi.mock('@/shared/ui/console-detail/ConsoleTimestamp', () => ({
  ConsoleTimestamp: ({ value }: { value: string }) => <time>{value}</time>,
}))

const t = ((key: string, values?: Record<string, string>) =>
  values ? `${key} ${JSON.stringify(values)}` : key) as unknown as OverviewTranslations

const base: AdminOverviewPublicDelivery = {
  state: 'healthy',
  offReason: null,
  delivery: 'external',
  layout: 'two',
  publicBaseUrl: 'https://cdn.example.test',
  checkedAt: '2026-09-30T12:00:00.000Z',
  stage: null,
  failure: null,
}

function state(check: Partial<AdminOverviewPublicDelivery>) {
  return render(<OverviewPublicState check={{ ...base, ...check }} t={t} />)
}

describe('public files overview', () => {
  it('shows a served result with its check time', () => {
    state({})
    expect(screen.getByText('overviewPublicServed')).toBeInTheDocument()
    expect(screen.getByText('2026-09-30T12:00:00.000Z')).toBeInTheDocument()
  })

  it.each([
    ['local_driver', 'overviewPublicOffLocal'],
    ['memory_driver', 'overviewPublicOffMemory'],
    ['disabled', 'overviewPublicOffDisabled'],
    ['worker_process', 'overviewPublicOffWorker'],
  ] as const)('explains why the check is off (%s)', (offReason, text) => {
    state({ state: 'off', offReason, checkedAt: null })
    expect(screen.getByText('overviewPublicOff')).toBeInTheDocument()
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByText('overviewFilesLastCheck:', { exact: false })).toBeNull()
  })

  it.each([
    ['external', 'overviewPublicHintExternal'],
    ['acl', 'overviewPublicHintAcl'],
    ['api', 'overviewPublicHintApi'],
  ] as const)('gives the %s hint when the public address does not serve', (delivery, hint) => {
    state({ state: 'failed', failure: 'public_not_served', stage: 'public_read', delivery })
    expect(screen.getByText('overviewPublicNotServed')).toBeInTheDocument()
    expect(screen.getByText(hint)).toBeInTheDocument()
  })

  it('reports unknown and stale results', () => {
    state({ state: 'unknown', checkedAt: null })
    expect(screen.getByText('overviewFilesUnknown')).toBeInTheDocument()
  })

  it('shows the exposed state without a repair hint and raises the banner', () => {
    const exposed = { ...base, state: 'failed', failure: 'private_exposed' } as const
    render(<OverviewPublicState check={{ ...exposed, stage: 'private_exposed_base' }} t={t} />)
    expect(screen.getByText('overviewPublicExposed')).toBeInTheDocument()
    render(<OverviewExposureBanner check={{ ...exposed, stage: 'private_exposed_base' }} t={t} />)
    expect(screen.getByRole('alert')).toHaveTextContent('overviewPublicExposedTitle')
    expect(screen.getByText('overviewPublicExposedBase')).toBeInTheDocument()
    expect(screen.getByText('overviewPublicExposedAction')).toBeInTheDocument()
  })

  it('renders no banner for an ordinary failure', () => {
    render(
      <OverviewExposureBanner
        check={{ ...base, state: 'failed', failure: 'public_not_served' }}
        t={t}
      />
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows configuration without bucket names, and the missing-address wording', () => {
    const { container } = render(<OverviewPublicConfig check={base} t={t} />)
    expect(container).toHaveTextContent('https://cdn.example.test')
    render(<OverviewPublicConfig check={{ ...base, publicBaseUrl: null }} t={t} />)
    expect(screen.getByText(/overviewPublicConfigNoUrl/)).toBeInTheDocument()
  })
})
