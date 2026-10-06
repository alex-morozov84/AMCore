import type { InviteListItem } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { InvitationListSkeleton } from './invitation-list-skeleton'
import { InvitationTable } from './invitation-table'

const row: InviteListItem = {
  id: 'invitation-example',
  email: 'invited@example.test',
  generation: 1,
  issuedAt: '2026-01-01T12:00:00.000Z',
  issuedAtEstimated: false,
  expiresAt: '2026-01-08T12:00:00.000Z',
  status: 'pending',
  intentValid: true,
  roles: [
    {
      requestedRoleId: 'role-example',
      id: 'role-example',
      nameAtIssue: 'MEMBER',
      name: 'MEMBER',
      description: 'Example role description',
    },
  ],
}
const meta = {
  title: 'Widgets/Organization invitations/Table',
  component: InvitationTable,
  args: { rows: [row], disabled: false, onAction: fn() },
} satisfies Meta<typeof InvitationTable>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('table')).toBeVisible()
    const item = canvas.getByRole('row', { name: /invited@example.test/ })
    await userEvent.click(within(item).getByRole('button', { name: /invited@example.test/ }))
    const menu = within(canvasElement.ownerDocument.body)
    const choices = await menu.findAllByRole('menuitem')
    await expect(choices).toHaveLength(3)
    await userEvent.click(choices[0])
    await expect(args.onAction).toHaveBeenCalledWith(row, 'repeat', expect.any(HTMLElement))
    await waitFor(() => expect(menu.queryByRole('menu')).not.toBeInTheDocument())
    await expect(within(item).getByRole('button', { name: /invited@example.test/ })).toHaveFocus()
  },
}
export const ExpiredDeletedRole: Story = {
  args: {
    rows: [
      {
        ...row,
        status: 'expired',
        intentValid: false,
        roles: [{ ...row.roles[0], id: null, name: null, description: null }],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('row', { name: /invited@example.test/ })
    ).toBeVisible()
  },
}
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const item = within(canvasElement).getByRole('row', { name: /invited@example.test/ })
    await expect(within(item).getByRole('button', { name: /invited@example.test/ })).toBeDisabled()
  },
}
export const Loading: Story = {
  render: () => <InvitationListSkeleton />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toBeInTheDocument()
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument()
  },
}
