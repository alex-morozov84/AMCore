import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { DropdownMenuItem } from './dropdown-menu'
import { RowActionsMenu } from './row-actions-menu'

const meta = {
  title: 'shared/ui/RowActionsMenu',
  component: RowActionsMenu,
} satisfies Meta<typeof RowActionsMenu>

export default meta
type Story = StoryObj<typeof meta>

// Mirrors a real reference consumer:
// _pages/settings/SessionsPage/SessionsTable.tsx's per-row menu.
export const SingleItem: Story = {
  args: {
    label: 'Actions',
    children: <DropdownMenuItem variant="destructive">Revoke</DropdownMenuItem>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Actions' }))

    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getByRole('menuitem', { name: 'Revoke' })).toBeInTheDocument())
  },
}

// Mirrors the other reference consumer —
// _pages/console/UsersPage/UserRoleAction.tsx — a menu that will hold a
// second item once a future console slice adds one, without touching the
// table's column width.
export const MultipleItems: Story = {
  args: {
    label: 'Actions',
    children: (
      <>
        <DropdownMenuItem>Promote to admin</DropdownMenuItem>
        <DropdownMenuItem variant="destructive">Revoke sessions</DropdownMenuItem>
      </>
    ),
  },
}
