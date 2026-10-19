import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Timestamp } from './timestamp'

const meta = {
  title: 'shared/ui/Timestamp',
  component: Timestamp,
  args: { value: '2026-10-19T10:30:00.000Z', timeZone: 'UTC' },
} satisfies Meta<typeof Timestamp>
export default meta
type Story = StoryObj<typeof meta>
export const Stacked: Story = {}
export const Inline: Story = { args: { variant: 'inline' } }
export const DateOnly: Story = { args: { variant: 'date' } }
