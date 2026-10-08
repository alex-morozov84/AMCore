import { CAPABILITY_CATALOGUE } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CapabilityEditor } from './capability-editor'

const meta = {
  title: 'Features/Role editor/Capability editor',
  component: CapabilityEditor,
  args: {
    capabilities: CAPABILITY_CATALOGUE as never,
    keys: ['organization.read:all'],
    disabled: false,
    onToggle: fn(),
  },
} satisfies Meta<typeof CapabilityEditor>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole('group', { name: /Edit organization details/ })
    await userEvent.click(within(group).getByRole('checkbox', { name: 'Own' }))
    await expect(args.onToggle).toHaveBeenCalledWith('organization.update', 'own')
  },
}

export const ReadOnly: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const checkbox = within(canvasElement).getAllByRole('checkbox')[0]
    await expect(checkbox).toHaveAttribute('aria-disabled', 'true')
  },
}
