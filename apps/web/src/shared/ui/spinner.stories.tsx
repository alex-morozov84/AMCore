import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Spinner } from './spinner'

const meta = {
  title: 'shared/ui/Spinner',
  component: Spinner,
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
  },
} satisfies Meta<typeof Spinner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Small: Story = {
  args: { size: 'sm' },
}

export const Large: Story = {
  args: { size: 'lg' },
}
