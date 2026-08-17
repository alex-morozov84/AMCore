import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Skeleton } from './skeleton'

const meta = {
  title: 'shared/ui/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    className: 'h-4 w-48',
  },
}

// A composed loading-state example — the "loading" placeholder for a row
// like the one views/settings/SessionsPage/SessionsTable.tsx renders once
// data resolves.
export const TableRowLoading: Story = {
  render: () => (
    <div className="flex items-center gap-4 w-96">
      <Skeleton className="size-8 rounded-full" />
      <div className="flex flex-col gap-2 flex-1">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  ),
}
