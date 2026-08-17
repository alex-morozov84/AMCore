import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Button } from './button'
import { toast, Toaster } from './toast'

// `Toaster` isn't mounted globally in `.storybook/preview.tsx` (unlike the
// real app's `Providers` tree) — each story mounts its own, matching
// toast.test.tsx's pattern of rendering `<Toaster />` directly.
function ToastDemo({
  type,
  title,
  description,
}: {
  type?: 'success' | 'info' | 'warning' | 'error' | 'loading'
  title: string
  description?: string
}) {
  return (
    <>
      <Button onClick={() => toast.add({ title, description, type })}>Show toast</Button>
      <Toaster closeLabel="Close" />
    </>
  )
}

const meta = {
  title: 'shared/ui/Toast',
  component: ToastDemo,
} satisfies Meta<typeof ToastDemo>

export default meta
type Story = StoryObj<typeof meta>

async function showAndAssertToast(canvasElement: HTMLElement, titleMatch: RegExp) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: /show toast/i }))

  const body = within(canvasElement.ownerDocument.body)
  await waitFor(() => expect(body.getByText(titleMatch)).toBeInTheDocument())
}

export const Default: Story = {
  args: { title: 'Session revoked' },
  play: async ({ canvasElement }) => {
    await showAndAssertToast(canvasElement, /session revoked/i)
  },
}

export const Success: Story = {
  args: { type: 'success', title: 'Changes saved' },
  play: async ({ canvasElement }) => {
    await showAndAssertToast(canvasElement, /changes saved/i)
  },
}

export const ErrorToast: Story = {
  args: {
    type: 'error',
    title: 'Could not revoke session',
    description: 'Check your connection and try again.',
  },
  play: async ({ canvasElement }) => {
    await showAndAssertToast(canvasElement, /could not revoke session/i)
  },
}
