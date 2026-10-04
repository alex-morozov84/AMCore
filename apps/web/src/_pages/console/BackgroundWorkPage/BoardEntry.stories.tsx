import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'

import { BoardEntry } from './BoardEntry'

const meta = {
  title: 'pages/console/BackgroundWork/BoardEntry',
  component: BoardEntry,
  args: {
    state: 'available',
    href: '/api/console/bull-board/',
    guideHref: 'https://docs.example.test/queue-board#enabling-the-board',
    onOpen: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BoardEntry>
export default meta
type Story = StoryObj<typeof meta>

/** The standing view-only note, calm (role=note), and the way to open the board in a new tab. */
export const Available: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Queue board is view-only').closest('[role="note"]')
    ).not.toBeNull()
    const link = canvas.getByRole('link', { name: /Open queue board/ })
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  },
}

/** The last attempt to open the board failed but it is available now: notice plus the button. */
export const OpenFailed: Story = {
  args: { state: 'open-failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('Could not open the queue board')
    await expect(canvas.getByRole('link', { name: /Open queue board/ })).toBeVisible()
  },
}

/** Confirmed disabled: how to turn it on (and that it stays view-only), no button. */
export const Disabled: Story = {
  args: { state: 'disabled' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('link', { name: /Open queue board/ })).toBeNull()
    await expect(canvas.getByText(/restart the API/)).toBeVisible()
    await expect(canvas.getByRole('link', { name: /Queue board guide/ })).toBeVisible()
  },
}

/** Access is being re-verified: only the standing note, never disabled or failed. */
export const NoLiveData: Story = { args: { state: 'none' } }

/** The longest copy at a phone width: titles wrap instead of being clipped, nothing scrolls sideways. */
export const DisabledAtPhoneWidth: Story = {
  args: { state: 'disabled' },
  decorators: [
    (Story) => (
      <div className="w-[320px]">
        <Story />
      </div>
    ),
  ],
}
