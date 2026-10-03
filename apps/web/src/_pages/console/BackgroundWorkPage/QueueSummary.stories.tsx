import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'

import { ConsoleTimeZoneProvider } from '@/shared/lib/console-time-zone'

import {
  allUnavailableSummary,
  availableQueue,
  disabledQueue,
  mixedSummary,
  summary,
} from './queue-fixtures'
import { QueueCards } from './QueueCards'
import { QueueSummaryControls } from './QueueSummaryControls'
import { QueueTable } from './QueueTable'

type Controls = Parameters<typeof QueueSummaryControls>[0]

function StoryQueueSummary({
  queues,
  controls,
}: {
  queues: typeof mixedSummary.queues
  controls: Controls
}) {
  return (
    <ConsoleTimeZoneProvider>
      <div className="flex flex-col gap-4 p-4">
        <QueueSummaryControls {...controls} />
        <QueueTable queues={queues} />
        <QueueCards queues={queues} />
      </div>
    </ConsoleTimeZoneProvider>
  )
}

const controls: Controls = {
  auto: true,
  onAutoChange: fn(),
  onRefresh: fn(),
  isFetching: false,
  canRefresh: true,
  online: true,
  retryAfterSeconds: 0,
}

const meta = {
  title: 'pages/console/BackgroundWork',
  component: StoryQueueSummary,
  args: { queues: mixedSummary.queues, controls },
} satisfies Meta<typeof StoryQueueSummary>
export default meta
type Story = StoryObj<typeof meta>

export const Mixed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('Paused').length).toBeGreaterThan(0)
    await expect(canvas.getAllByText('Unavailable').length).toBeGreaterThan(0)
    await expect(canvas.getAllByText('At least 4 minutes').length).toBeGreaterThan(0)
  },
}

export const IdleAndEmpty: Story = {
  args: {
    queues: summary([
      availableQueue('email'),
      availableQueue('default'),
      availableQueue('notifications'),
    ]).queues,
  },
}

export const EveryQueueUnavailable: Story = { args: { queues: allUnavailableSummary.queues } }

export const DisabledAndCustomQueue: Story = {
  args: {
    queues: summary([
      disabledQueue('default'),
      availableQueue('my-reports', {
        kind: 'extension',
        age: { status: 'unknown' },
        counts: { waiting: 3 },
      }),
    ]).queues,
  },
}

export const AutoRefreshPausedAndBusy: Story = {
  args: { controls: { ...controls, auto: false, isFetching: true } },
}

export const Offline: Story = {
  args: { controls: { ...controls, online: false, canRefresh: false } },
}

export const BlockedByRetryAfter: Story = {
  args: { controls: { ...controls, canRefresh: false, retryAfterSeconds: 42 } },
}
