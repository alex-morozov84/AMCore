import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Button } from './button'
import { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog'

function ConfirmDialogDemo(props: Omit<ConfirmDialogProps, 'open' | 'onOpenChange'>) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {props.confirmLabel}
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} {...props} />
    </>
  )
}

const meta = {
  title: 'shared/ui/ConfirmDialog',
  component: ConfirmDialogDemo,
} satisfies Meta<typeof ConfirmDialogDemo>

export default meta
type Story = StoryObj<typeof meta>

// Mirrors a real reference consumer:
// features/sessions-revoke-other/ui/RevokeOtherSessionsButton.tsx.
export const Destructive: Story = {
  args: {
    title: 'Revoke all other sessions?',
    description: "Every other device will be signed out immediately. This can't be undone.",
    confirmLabel: 'Revoke all',
    cancelLabel: 'Cancel',
    variant: 'destructive',
    onConfirm: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /revoke all/i }))

    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getByRole('alertdialog')).toBeInTheDocument())

    await userEvent.click(body.getByRole('button', { name: /^cancel$/i }))
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument())
  },
}

// Mirrors the other reference consumer — a non-destructive confirmation
// (promoting a user) opened from a dropdown menu item, alongside the
// module's dangerous counterpart (demoting one).
export const Default: Story = {
  args: {
    title: 'Promote to SUPER_ADMIN?',
    description: 'This user will gain full administrative access.',
    confirmLabel: 'Promote to admin',
    cancelLabel: 'Cancel',
    variant: 'default',
    onConfirm: () => {},
  },
}

export const Disabled: Story = {
  args: {
    ...Default.args,
    disabled: true,
  },
}
