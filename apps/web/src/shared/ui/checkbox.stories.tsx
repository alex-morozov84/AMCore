import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Checkbox } from './checkbox'

const meta = {
  title: 'shared/ui/Checkbox',
  component: Checkbox,
  args: { 'aria-label': 'Select item' },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Checked: Story = { args: { defaultChecked: true } }
export const Disabled: Story = { args: { disabled: true } }
export const DisabledChecked: Story = { args: { disabled: true, defaultChecked: true } }

export const Indeterminate: Story = { args: { indeterminate: true } }
