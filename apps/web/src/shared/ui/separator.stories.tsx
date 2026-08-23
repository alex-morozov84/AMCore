import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Separator } from './separator'

const meta = {
  title: 'shared/ui/Separator',
  component: Separator,
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

// Pulled in by sidebar.tsx's `SidebarSeparator` — no standalone consumer yet.
export const Horizontal: Story = {
  render: () => (
    <div className="w-64">
      <div className="text-sm">Above</div>
      <Separator className="my-2" />
      <div className="text-sm">Below</div>
    </div>
  ),
}

export const Vertical: Story = {
  render: () => (
    <div className="flex h-8 items-center gap-2">
      <span className="text-sm">Left</span>
      <Separator orientation="vertical" />
      <span className="text-sm">Right</span>
    </div>
  ),
}
