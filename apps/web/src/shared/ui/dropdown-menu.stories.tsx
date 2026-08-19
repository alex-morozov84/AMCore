import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MoreHorizontal } from 'lucide-react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'

const meta = {
  title: 'shared/ui/DropdownMenu',
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

// Mirrors the real reference consumer: the sessions table's row-actions
// menu (_pages/settings/SessionsPage/SessionsTable.tsx) — an icon-only
// trigger with an `sr-only` accessible name.
export const Default: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <span className="sr-only">Actions</span>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Session</DropdownMenuLabel>
          <DropdownMenuItem>View details</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Revoke</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /actions/i }))

    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getByRole('menu')).toBeInTheDocument())
    expect(body.getByRole('menuitem', { name: /revoke/i })).toBeInTheDocument()
  },
}

export const WithCheckboxItems: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        Columns
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuCheckboxItem checked>Device</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked>Last active</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem>Location</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  // Opened via a real trigger click, not `defaultOpen` — a render-open menu
  // hits Base UI's internal focus-guard sentinels in a state axe flags as a
  // real `aria-hidden-focus` violation (confirmed live); opening the same
  // way `Default` above does avoids it, and is the real interaction pattern
  // anyway.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /columns/i }))

    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getByRole('menu')).toBeInTheDocument())
  },
}
