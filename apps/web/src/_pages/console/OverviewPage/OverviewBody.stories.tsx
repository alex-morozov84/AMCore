import type { ComponentProps } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { ConsoleTimeZoneProvider } from '@/shared/lib/console-time-zone'

import { overviewFixture } from './overview-fixture'
import { OverviewBody } from './OverviewBody'

function StoryOverview(args: Pick<ComponentProps<typeof OverviewBody>, 'overview' | 'artifactId'>) {
  const t = useTranslations('console')
  const format = useFormatter()
  return (
    <ConsoleTimeZoneProvider>
      <div className="flex flex-col gap-4 p-4">
        <OverviewBody {...args} t={t} format={format} />
      </div>
    </ConsoleTimeZoneProvider>
  )
}

const meta = {
  title: 'pages/console/Overview',
  component: StoryOverview,
  args: { overview: overviewFixture, artifactId: 'web-artifact-independent' },
} satisfies Meta<typeof StoryOverview>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('web-artifact-independent')).toBeVisible()
    await expect(canvas.getByText(overviewFixture.process.instanceId)).toBeVisible()
  },
}

export const Degraded: Story = {
  args: {
    overview: {
      ...overviewFixture,
      readiness: 'degraded',
      dependencies: [{ name: 'redis', status: 'degraded' }],
    },
  },
}

export const NotReadyIndependentNumbers: Story = {
  args: {
    overview: {
      ...overviewFixture,
      readiness: 'not_ready',
      dependencies: [{ name: 'memory_heap', status: 'down' }],
    },
  },
}

export const UnknownAndPartial: Story = {
  args: {
    overview: {
      ...overviewFixture,
      api: {
        ...overviewFixture.api,
        version: null,
        commit: null,
        deploymentId: null,
        environment: null,
      },
      resources: {
        ...overviewFixture.resources,
        filesystem: { status: 'unavailable', sampledAt: null },
      },
    },
  },
}

export const LongIdentifiers: Story = {
  args: {
    overview: {
      ...overviewFixture,
      api: { ...overviewFixture.api, deploymentId: 'a'.repeat(128) },
    },
    artifactId: 'b'.repeat(128),
  },
  decorators: [
    (Story) => (
      <div className="w-[390px] max-w-full">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('a'.repeat(128))).toBeVisible()
    await expect(canvas.getByText('b'.repeat(128))).toBeVisible()
    const container = canvasElement.firstElementChild as HTMLElement
    await expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth)
  },
}
