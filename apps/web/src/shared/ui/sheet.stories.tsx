import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Button } from './button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet'

const meta = {
  title: 'shared/ui/Sheet',
  component: Sheet,
} satisfies Meta<typeof Sheet>

export default meta
type Story = StoryObj<typeof meta>

// `closeLabel` is required — see sheet.tsx's `SheetContentProps` union,
// same discriminated-union shape as `DialogContent`'s. Real interaction:
// opens on trigger click, closes on the built-in close button.
export const Default: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button />}>Open sheet</SheetTrigger>
      <SheetContent closeLabel="Close">
        <SheetHeader>
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>The mobile Sidebar renders through this primitive.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: /open sheet/i }))

    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getByRole('dialog')).toBeInTheDocument())
    expect(body.getByText('Navigation')).toBeInTheDocument()

    await userEvent.click(body.getByRole('button', { name: /^close$/i }))
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

export const WithoutCloseButton: Story = {
  render: () => (
    <Sheet defaultOpen>
      <SheetContent showCloseButton={false}>
        <SheetHeader>
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>
            The dashboard app shell hides this Sheet&apos;s own close button — `SidebarTrigger`
            toggles it instead.
          </SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
}
