import { useTranslations } from 'next-intl'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import type { ConsoleExternalLinks } from '@/shared/lib/console-external-links'

import { OverviewExternalTools } from './OverviewExternalTools'

function StoryCard({
  links,
  logSearchConfigured = false,
}: {
  links: ConsoleExternalLinks
  logSearchConfigured?: boolean
}) {
  const t = useTranslations('console')
  return (
    <div className="max-w-xl p-4">
      <OverviewExternalTools links={links} logSearchConfigured={logSearchConfigured} t={t} />
    </div>
  )
}

const meta = {
  title: 'pages/console/Overview/ExternalTools',
  component: StoryCard,
} satisfies Meta<typeof StoryCard>
export default meta
type Story = StoryObj<typeof meta>

export const NothingConfigured: Story = {
  args: { links: { metrics: null, logs: null, alerts: null } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('External tools are not configured.')).toBeVisible()
    await expect(canvas.getByRole('link', { name: /Recovery instructions/ })).toBeVisible()
  },
}

export const PartlyConfigured: Story = {
  args: {
    links: { metrics: 'https://grafana.example.com/d/amcore', logs: null, alerts: null },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: /Metrics/ })).toBeVisible()
    await expect(canvas.getByText('Logs: not configured.')).toBeVisible()
  },
}

export const AllConfigured: Story = {
  args: {
    links: {
      metrics: 'https://grafana.example.com/d/amcore',
      logs: 'https://grafana.example.com/explore',
      alerts: 'https://alerts.example.com/',
    },
  },
}

export const LogLinksNotConfigured: Story = {
  args: { links: { metrics: null, logs: 'https://grafana.example.com/', alerts: null } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Log links on jobs and audit events: not configured.')
    ).toBeVisible()
  },
}
