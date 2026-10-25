import { createTranslator, NextIntlClientProvider, useLocale, useTranslations } from 'next-intl'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { ConsoleTimeZoneProvider } from '@/shared/lib/console-time-zone'

import en from '../../../../messages/en.json'
import ru from '../../../../messages/ru.json'

import { fileConflictSources } from './overview-problem-fixtures'
import { overviewProblems } from './overview-problems'
import { OverviewProblems } from './OverviewProblems'

function FileObservations({ primaryFailed }: { primaryFailed: boolean }) {
  const t = useTranslations('console.problems')
  const locale = useLocale()
  const model = overviewProblems(fileConflictSources(primaryFailed), {
    t,
    locale,
    name: (_kind, id) => id,
  })
  return (
    <ConsoleTimeZoneProvider>
      <OverviewProblems model={model} t={t} metrics={null} newTabLabel="opens in a new tab" />
    </ConsoleTimeZoneProvider>
  )
}
const meta = {
  title: 'pages/console/File observations',
  component: FileObservations,
  args: { primaryFailed: false },
  decorators: [
    (Story) => (
      <div className="w-80 max-w-full p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FileObservations>
export default meta
type Story = StoryObj<typeof meta>

async function checkTimes(canvasElement: HTMLElement) {
  for (const stamp of ['2026-10-25T12:10:00.000Z', '2026-10-24T12:00:00.000Z']) {
    const times = canvasElement.querySelectorAll(`time[datetime="${stamp}"]`)
    await expect(times).toHaveLength(1)
    await expect(times[0]).toBeVisible()
  }
  await expect(canvasElement.querySelectorAll('li')).toHaveLength(1)
  const card = canvasElement.querySelector('[data-slot="card"]')!
  await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
}
const catalogues: Record<string, typeof en> = { en, ru }
const baseMessages = catalogues[DEFAULT_LOCALE]
const baseCopy = createTranslator({
  locale: DEFAULT_LOCALE,
  messages: baseMessages,
  namespace: 'console.problems',
})
export const HealthyOverviewOldFailure: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(baseCopy('fileOverviewResult', { result: baseCopy('privatePassed') }), {
        exact: true,
      })
    ).toBeVisible()
    await expect(
      canvas.getByText(
        baseCopy('fileIntegrationResult', { result: baseCopy('privateFailed') }) +
          ' ' +
          baseCopy('old'),
        { exact: true }
      )
    ).toBeVisible()
    await checkTimes(canvasElement)
  },
}
export const FailedOverviewOldSuccess: Story = {
  args: { primaryFailed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(baseCopy('fileOverviewResult', { result: baseCopy('privateFailed') }), {
        exact: true,
      })
    ).toBeVisible()
    await expect(
      canvas.getByText(
        baseCopy('fileIntegrationResult', { result: baseCopy('privatePassed') }) +
          ' ' +
          baseCopy('old'),
        { exact: true }
      )
    ).toBeVisible()
    await checkTimes(canvasElement)
  },
}
const russianLocale = new Set<string>(SUPPORTED_LOCALES).has('ru') ? 'ru' : DEFAULT_LOCALE
const ruCopy = createTranslator({
  locale: russianLocale,
  messages: ru,
  namespace: 'console.problems',
})
const russian: NonNullable<Story['decorators']> = [
  (Story) => (
    <NextIntlClientProvider locale={russianLocale} messages={ru} timeZone="UTC">
      <Story />
    </NextIntlClientProvider>
  ),
]
export const RussianHealthyOverviewOldFailure: Story = {
  decorators: russian,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(ruCopy('fileOverviewResult', { result: ruCopy('privatePassed') }), {
        exact: true,
      })
    ).toBeVisible()
    await expect(
      canvas.getByText(
        ruCopy('fileIntegrationResult', { result: ruCopy('privateFailed') }) + ' ' + ruCopy('old'),
        { exact: true }
      )
    ).toBeVisible()
    await checkTimes(canvasElement)
  },
}
export const RussianFailedOverviewOldSuccess: Story = {
  args: { primaryFailed: true },
  decorators: russian,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(ruCopy('fileOverviewResult', { result: ruCopy('privateFailed') }), {
        exact: true,
      })
    ).toBeVisible()
    await expect(
      canvas.getByText(
        ruCopy('fileIntegrationResult', { result: ruCopy('privatePassed') }) + ' ' + ruCopy('old'),
        { exact: true }
      )
    ).toBeVisible()
    await checkTimes(canvasElement)
  },
}
