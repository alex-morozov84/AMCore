import { useState } from 'react'
import type { WorkJob, WorkSummary } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, within } from 'storybook/test'

import { getConsolePublicApiPath } from '@/shared/lib/console-public-api-path'
import { Checkbox } from '@/shared/ui/checkbox'
import { FilterButtons } from '@/shared/ui/filter-buttons'

import { WorkAttemptHistory } from './WorkAttemptHistory'
import { WorkCard } from './WorkCard'

function SelectionFixture({ dark = false }: { dark?: boolean }) {
  return (
    <div className={dark ? 'dark' : ''}>
      <div className="flex gap-4 bg-background p-4 text-foreground [--selection:var(--console-accent)] [--selection-foreground:var(--console-accent-foreground)]">
        <Checkbox aria-label="Selected task" checked />
        <Checkbox aria-label="Mixed selection" indeterminate />
        <FilterButtons
          label="Task state"
          value="failed"
          options={[{ value: 'failed', label: 'Failed' }]}
          onChange={() => {}}
        />
      </div>
    </div>
  )
}

const meta = {
  title: 'features/Console background work/Selection',
  component: SelectionFixture,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const checked = canvas.getByRole('checkbox', { name: 'Selected task' })
    const mixed = canvas.getByRole('checkbox', { name: 'Mixed selection' })
    const filter = canvas.getByRole('button', { name: 'Failed' })
    await expect(checked).toBeChecked()
    await expect(mixed).toHaveAttribute('aria-checked', 'mixed')
    await expect(mixed).toHaveAttribute('data-indeterminate')
    for (const element of [checked, mixed]) {
      await expect(getComputedStyle(element).backgroundColor).toBe(
        getComputedStyle(filter).backgroundColor
      )
      await expect(getComputedStyle(element).color).toBe(getComputedStyle(filter).color)
    }
  },
} satisfies Meta<typeof SelectionFixture>
export default meta
type Story = StoryObj<typeof meta>
export const Light: Story = {}
export const Dark: Story = { args: { dark: true } }

const delivery: WorkJob = {
  identity: {
    id: 'story-delivery',
    incarnation: '019a1234-1234-7123-8123-123456789012',
    revision: 'a'.repeat(64),
  },
  state: 'failed',
  nativeState: 'FAILED',
  jobName: 'notification-delivery',
  wireVersion: 1,
  sampledAt: '2026-10-11T12:00:00.000Z',
  source: 'domain',
  replay: 'durable',
  attemptsStarted: 5,
  attemptsMade: 5,
  manualGrant: 'none',
  certainty: 'unknown',
  projection: {},
  capabilities: [],
}
const detailRoute = `/api${getConsolePublicApiPath('/background-work/works/notification-deliveries/jobs/story-delivery')}`
function NotificationInspectionFixture() {
  const [open, setOpen] = useState(true)
  return (
    <WorkAttemptHistory
      workId="notification-deliveries"
      row={delivery}
      open={open}
      onOpenChange={setOpen}
    />
  )
}
const history = {
  attempts: [
    {
      number: 5,
      startedAt: delivery.sampledAt,
      finishedAt: delivery.sampledAt,
      outcome: 'transient_failure' as const,
      certainty: 'unknown' as const,
      reason: 'telegram_rate_limited',
    },
  ],
  historyTruncated: false,
  historyExpired: false,
  oldestRetainedNumber: 5,
}
function historyStory(value: NonNullable<WorkJob['history']>, text: string): Story {
  return {
    render: () => <NotificationInspectionFixture />,
    parameters: {
      msw: {
        handlers: [http.get(detailRoute, () => HttpResponse.json({ ...delivery, history: value }))],
      },
    },
    play: async ({ canvasElement }) => {
      await expect(within(canvasElement).findByText(text, { exact: false })).resolves.toBeVisible()
    },
  }
}
export const HistoryUnknown = historyStory(history, 'Temporary failure')
export const HistoryRevoked = historyStory(
  {
    ...history,
    attempts: [{ ...history.attempts[0]!, outcome: 'abandoned', reason: 'delivery_cancelled' }],
  },
  'Interrupted'
)
export const HistoryLeaseExpired = historyStory(
  {
    ...history,
    attempts: [{ ...history.attempts[0]!, outcome: 'abandoned', reason: 'lease_expired' }],
  },
  'Interrupted'
)
export const HistoryEmpty = historyStory({ ...history, attempts: [] }, 'No retained attempts.')
export const HistoryTruncated = historyStory(
  { ...history, historyTruncated: true },
  'Only the latest 16 attempts are shown.'
)
export const HistoryExpired = historyStory(
  { ...history, historyExpired: true },
  'Older attempt records expired. Delivery certainty and the lifetime grant remain preserved.'
)
export const HistoryError: Story = {
  render: () => <NotificationInspectionFixture />,
  parameters: {
    msw: { handlers: [http.get(detailRoute, () => HttpResponse.json({}, { status: 503 }))] },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByRole('alert')).resolves.toBeVisible()
  },
}
const draining: WorkSummary = {
  id: 'notification-deliveries',
  kind: 'durable',
  definitionVersion: 1,
  status: 'available',
  paused: true,
  sampledAt: delivery.sampledAt,
  revision: 'a'.repeat(64),
  counts: {
    processing: { value: 1, truncated: false },
    pending: { value: 2, truncated: false },
    due: { value: 1, truncated: false },
    failed: { value: 0, truncated: false },
    terminal: { value: 0, truncated: false },
    unresolved: { value: 1, truncated: false },
  },
  capabilities: [],
  presentation: {
    name: { en: 'Notification deliveries' },
    fields: {},
    commandSemantics: {
      pause: 'claims',
      retry: 'scheduled-single-grant',
      cleanupMinimumAgeSeconds: 2592000,
    },
  },
}
export const DeliveryDraining: Story = {
  render: () => (
    <WorkCard
      work={draining}
      selected={false}
      blocked={false}
      onInspect={() => {}}
      onCapture={() => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByText('Notification deliveries')).resolves.toBeVisible()
  },
}
