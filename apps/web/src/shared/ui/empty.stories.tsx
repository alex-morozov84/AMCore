import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { InboxIcon } from 'lucide-react'

import { Button } from './button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './empty'

const meta = {
  title: 'shared/ui/Empty',
  component: Empty,
} satisfies Meta<typeof Empty>

export default meta
type Story = StoryObj<typeof meta>

// The "no rows" state a table like
// views/settings/SessionsPage/SessionsTable.tsx would show once loading
// resolves with zero results.
export const NoActiveSessions: Story = {
  render: () => (
    <Empty className="w-96">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>No active sessions</EmptyTitle>
        <EmptyDescription>Sign in from another device to see it listed here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
}

export const WithAction: Story = {
  render: () => (
    <Empty className="w-96">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>No results</EmptyTitle>
        <EmptyDescription>Try adjusting your filters.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm">
          Clear filters
        </Button>
      </EmptyContent>
    </Empty>
  ),
}
