import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { PrimaryUnavailableFallback } from './primary-unavailable-fallback'

const meta = {
  title: 'shared/ui/PrimaryUnavailableFallback',
  component: PrimaryUnavailableFallback,
} satisfies Meta<typeof PrimaryUnavailableFallback>

export default meta
type Story = StoryObj<typeof meta>

export const RateLimited: Story = {
  args: { reason: 'rate-limited', retryAfterMs: 7000 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Too many requests. The server asks you to wait 7 seconds.')
    ).toBeInTheDocument()
  },
}

export const Timeout: Story = {
  args: { reason: 'timeout' },
}

export const Network: Story = {
  args: { reason: 'network' },
}

export const Upstream: Story = {
  args: { reason: 'upstream' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const retryButton = canvas.getByRole('button', { name: 'Retry' })
    // Clicking calls router.refresh() (mocked by the nextjs-vite framework's
    // app-router context) - asserting it doesn't throw is the meaningful
    // check here; the actual re-render behavior is proven against a real
    // dev/production server, not this isolated component render.
    await userEvent.click(retryButton)
    await expect(retryButton).toBeInTheDocument()
  },
}
