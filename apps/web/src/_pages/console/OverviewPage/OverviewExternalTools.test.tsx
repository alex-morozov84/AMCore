import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { docsFolderHref } from '@/shared/lib/console-docs-links'
import type { ConsoleExternalLinks } from '@/shared/lib/console-external-links'

import type { OverviewTranslations } from './overview-types'
import { OverviewExternalTools } from './OverviewExternalTools'

const text: Record<string, string> = {
  externalToolsTitle: 'External tools',
  externalToolsHelp: 'help',
  externalToolsNone: 'External tools are not configured.',
  externalToolsMetrics: 'Metrics',
  externalToolsLogs: 'Logs',
  externalToolsAlerts: 'Alerts',
  externalToolsToolNotConfigured: '{tool}: not configured.',
  externalToolsHowTo: 'How to connect',
  externalToolsRecovery: 'Recovery instructions',
  externalToolsLogLinksNotConfigured: 'Log links on jobs and audit events: not configured.',
  overviewPublicOpenNewTab: '(opens in a new tab)',
}
const t = ((key: string, values?: Record<string, string>) =>
  (text[key] ?? key).replace('{tool}', values?.tool ?? '')) as unknown as OverviewTranslations

const none: ConsoleExternalLinks = { metrics: null, logs: null, alerts: null }

function renderCard(links: ConsoleExternalLinks, logSearchConfigured = false) {
  return render(
    <OverviewExternalTools links={links} logSearchConfigured={logSearchConfigured} t={t} />
  )
}

describe('OverviewExternalTools', () => {
  it('says once that nothing is configured and still offers the how-to and recovery links', () => {
    renderCard(none)
    expect(screen.getByText('External tools are not configured.')).toBeInTheDocument()
    expect(screen.queryByText(/: not configured\./)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /How to connect/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Recovery instructions/ })).toHaveAttribute(
      'href',
      docsFolderHref('docs/operations/runbooks')
    )
    expect(document.querySelector('[disabled], [aria-disabled="true"]')).toBeNull()
  })

  it('shows configured tools as links and the others as plain text, never as disabled controls', () => {
    renderCard({ metrics: 'https://grafana.example.com/d/x', logs: null, alerts: null })
    expect(screen.getByRole('link', { name: /Metrics/ })).toHaveAttribute(
      'href',
      'https://grafana.example.com/d/x'
    )
    expect(screen.getByText('Logs: not configured.')).toBeInTheDocument()
    expect(screen.getByText('Alerts: not configured.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Logs/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /How to connect/ })).toBeInTheDocument()
    expect(document.querySelector('[disabled], [aria-disabled="true"]')).toBeNull()
  })

  it('shows all three links and no how-to link when everything is configured', () => {
    renderCard(
      {
        metrics: 'https://grafana.example.com/d/x',
        logs: 'https://grafana.example.com/explore',
        alerts: 'https://alerts.example.com/',
      },
      true
    )
    expect(screen.getAllByRole('link')).toHaveLength(4)
    expect(screen.queryByRole('link', { name: /How to connect/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/not configured/)).not.toBeInTheDocument()
  })

  it('marks every link, button-style or text, with the external-link icon', () => {
    renderCard({ metrics: 'https://grafana.example.com/d/x', logs: null, alerts: null })
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    }
  })

  it('opens every link in a new tab without opener or referrer and announces it', () => {
    renderCard({ metrics: 'https://grafana.example.com/d/x', logs: null, alerts: null })
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(within(link).getByText(/opens in a new tab/)).toHaveClass('sr-only')
    }
  })

  describe('log links on jobs and audit events', () => {
    const withLogs: ConsoleExternalLinks = { ...none, logs: 'https://grafana.example.com/' }
    const note = 'Log links on jobs and audit events: not configured.'

    it('says they are not configured when the Logs link is set but the log-search address is not', () => {
      renderCard(withLogs)
      expect(screen.getByText(note)).toBeInTheDocument()
    })

    it('says nothing once the log-search address is set', () => {
      renderCard(withLogs, true)
      expect(screen.queryByText(note)).not.toBeInTheDocument()
    })

    it('adds no second line when no external tool is configured at all', () => {
      renderCard(none)
      expect(screen.queryByText(note)).not.toBeInTheDocument()
    })
  })
})
