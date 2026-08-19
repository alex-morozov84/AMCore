import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MoreHorizontal } from 'lucide-react'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Toaster } from '@/shared/ui/toast'

import { RevokeSessionMenuItem } from './RevokeSessionMenuItem'

// Mirrors the real reference consumer's composition exactly:
// _pages/settings/SessionsPage/SessionsTable.tsx's row-actions menu.
// `Toaster` isn't global in .storybook/preview.tsx — mounted per-story,
// same as shared/ui/toast.stories.tsx.
function RevokeSessionMenuItemDemo({ sessionId }: { sessionId: string }) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <span className="sr-only">Actions</span>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <RevokeSessionMenuItem sessionId={sessionId} />
        </DropdownMenuContent>
      </DropdownMenu>
      <Toaster closeLabel="Close" />
    </>
  )
}

const meta = {
  title: 'features/sessions-revoke/RevokeSessionMenuItem',
  component: RevokeSessionMenuItemDemo,
  args: {
    sessionId: 'session-123',
  },
} satisfies Meta<typeof RevokeSessionMenuItemDemo>

export default meta
type Story = StoryObj<typeof meta>

async function openMenuAndRevoke(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: /actions/i }))

  const body = within(canvasElement.ownerDocument.body)
  await userEvent.click(await body.findByRole('menuitem', { name: /revoke/i }))
  return body
}

// Real BFF mutation — DELETE /api/auth/sessions/:id — then the real toast +
// query-invalidation pattern (features/sessions-revoke/model/use-revoke-session.ts),
// the reference this starter wants downstream mutation/toast flows to copy.
export const Success: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.delete('/api/auth/sessions/session-123', () => new HttpResponse(null, { status: 204 }))
    )
  },
  play: async ({ canvasElement }) => {
    const body = await openMenuAndRevoke(canvasElement)
    await waitFor(() => expect(body.getByText('Session revoked')).toBeInTheDocument())
  },
}

export const ErrorState: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.delete('/api/auth/sessions/session-123', () =>
        HttpResponse.json({ message: 'Session already gone' }, { status: 404 })
      )
    )
  },
  play: async ({ canvasElement }) => {
    const body = await openMenuAndRevoke(canvasElement)
    // describeError() falls back to the generic translated message for an
    // unrecognized errorCode — see shared/ui/api-error-alert.stories.tsx's
    // UnknownErrorCode case for the same fallback.
    await waitFor(() =>
      expect(body.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
    )
  },
}
