import { createTranslator, useLocale, useTranslations } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { ConsoleTimeZoneProvider } from '@/shared/lib/console-time-zone'

import en from '../../../../messages/en.json'

import { count, job, OBSERVED, sources, work } from './overview-problem-fixtures'
import type { OverviewSources } from './overview-problem-model'
import { overviewProblems } from './overview-problems'
import { OverviewProblems } from './OverviewProblems'
function Summary({ data }: { data: OverviewSources }) {
  const t = useTranslations('console.problems')
  const locale = useLocale()
  const model = overviewProblems(data, { t, locale, name: (_kind, id) => id })
  return (
    <ConsoleTimeZoneProvider>
      <OverviewProblems model={model} t={t} metrics={null} newTabLabel="opens in a new tab" />
    </ConsoleTimeZoneProvider>
  )
}
const copy = createTranslator({
  locale: DEFAULT_LOCALE,
  messages: en,
  namespace: 'console.problems',
})
const meta = {
  title: 'pages/console/Overview problems',
  component: Summary,
  args: { data: sources() },
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Summary>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const Unavailable: Story = {
  args: {
    data: sources({
      overview: null,
      queues: null,
      works: null,
      scheduled: null,
      integrations: null,
    }),
  },
}
export const PartialCoverage: Story = {
  args: {
    data: sources({ integrations: null, scheduled: { checkedAt: OBSERVED, jobs: [job()] } }),
  },
}
export const MoreProblems: Story = {
  args: {
    data: sources({
      scheduled: {
        checkedAt: OBSERVED,
        jobs: Array.from({ length: 7 }, (_, i) =>
          job({
            id: `daily-job-${i}`,
            result: {
              state: 'failed',
              startedAt: OBSERVED,
              durationMs: 10,
              code: null,
              summary: null,
            },
          })
        ),
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText(copy('more', { count: 2 })))
    await expect(canvas.getByText('daily-job-6')).toBeVisible()
  },
}

export const LongName: Story = {
  args: {
    data: sources({
      works: [
        work({
          presentation: { name: { en: 'A'.repeat(80) }, fields: {} },
          counts: { ...work().counts!, failed: count(1) },
        }),
      ],
    }),
  },
  decorators: [
    (Story) => (
      <div className="w-80 max-w-full">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector('[data-slot="card"]')!
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
  },
}
