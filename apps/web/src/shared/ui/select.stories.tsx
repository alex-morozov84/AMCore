import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

const meta = {
  title: 'shared/ui/Select',
  component: SelectTrigger,
  args: { 'aria-label': 'Status' },
  render: (args) => (
    <Select defaultValue="active">
      <SelectTrigger {...args}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="expired">Expired</SelectItem>
        <SelectItem value="revoked" disabled>
          Revoked
        </SelectItem>
      </SelectContent>
    </Select>
  ),
} satisfies Meta<typeof SelectTrigger>

export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Disabled: Story = { args: { disabled: true } }
