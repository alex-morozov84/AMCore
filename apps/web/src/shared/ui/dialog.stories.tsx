import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Button } from './button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'

const meta = {
  title: 'shared/ui/Dialog',
  component: Dialog,
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

// `closeLabel` is required — see dialog.tsx's `DialogContentProps` union.
// Real interaction: opens on trigger click, closes on the built-in close
// button, matching dialog.test.tsx's own coverage.
export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>Open dialog</DialogTrigger>
      <DialogContent closeLabel="Close">
        <DialogHeader>
          <DialogTitle>Revoke session?</DialogTitle>
          <DialogDescription>This signs the device out immediately.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive">Revoke</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: /open dialog/i }))

    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getByRole('dialog')).toBeInTheDocument())
    expect(body.getByText('Revoke session?')).toBeInTheDocument()

    await userEvent.click(body.getByRole('button', { name: /^close$/i }))
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

export const WithoutCloseButton: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Processing…</DialogTitle>
          <DialogDescription>This can&apos;t be dismissed while it runs.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  ),
}
