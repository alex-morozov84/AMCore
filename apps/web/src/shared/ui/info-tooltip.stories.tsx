import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'

import { InfoTooltip } from './info-tooltip'

const meta = {
  title: 'shared/ui/InfoTooltip',
  component: InfoTooltip,
} satisfies Meta<typeof InfoTooltip>

export default meta
type Story = StoryObj<typeof meta>

// The tooltip content portals outside canvasElement (same pattern as
// dialog.stories.tsx's Default story), so it's asserted against
// document.body, not the canvas. Opens on focus, matching keyboard
// accessibility - not click, which base-ui's tooltip trigger ignores.
export const Default: Story = {
  args: { label: 'This explains the nearby field.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'This explains the nearby field.' })
    const body = within(canvasElement.ownerDocument.body)

    await expect(body.queryByText('This explains the nearby field.')).not.toBeInTheDocument()

    trigger.focus()
    await waitFor(() =>
      expect(body.getByText('This explains the nearby field.')).toBeInTheDocument()
    )
  },
}
