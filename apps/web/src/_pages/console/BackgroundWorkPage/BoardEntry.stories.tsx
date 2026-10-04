import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'

import { BoardNotices, BoardOpenAction } from './BoardEntry'

const meta = {
  title: 'pages/console/BackgroundWork/BoardEntry',
  component: BoardNotices,
  args: {
    state: 'disabled',
    guideHref: 'https://docs.example.test/queue-board#enabling-the-board',
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BoardNotices>
export default meta
type Story = StoryObj<typeof meta>

/** The page action: the button that opens the board in a new tab, with the view-only help icon. */
export const OpenAction: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <BoardOpenAction href="/api/console/bull-board" onOpen={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = canvas.getByRole('link', { name: /Open queue board/ })
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(canvas.getByLabelText(/Retrying or deleting jobs/)).toBeVisible()
  },
}

/** The last attempt to open the board failed but it is available now. */
export const OpenFailed: Story = {
  args: { state: 'open-failed' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Could not open the queue board'
    )
  },
}

/** Confirmed disabled: how to turn it on (and that it stays view-only), with the guide link. */
export const Disabled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/restart the API/)).toBeVisible()
    await expect(canvas.getByRole('link', { name: /Queue board guide/ })).toBeVisible()
  },
}

/** The longest copy at a phone width: titles wrap instead of being clipped, nothing scrolls sideways. */
export const DisabledAtPhoneWidth: Story = {
  decorators: [
    (Story) => (
      <div className="w-[320px]">
        <Story />
      </div>
    ),
  ],
}
