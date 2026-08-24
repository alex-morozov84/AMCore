import { AuthErrorCode } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ResetPasswordForm } from './ResetPasswordForm'

const meta = {
  title: 'features/auth-reset-password/ResetPasswordForm',
  component: ResetPasswordForm,
  args: {
    token: 'a'.repeat(64),
  },
} satisfies Meta<typeof ResetPasswordForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

// The route file only ever passes an absent `token` when the page was
// opened without the emailed `?token=` — a mistyped/stale link, not a
// validation failure the form can recover from. No mutation ever fires.
export const InvalidLink: Story = {
  args: {
    token: undefined,
  },
}

export const Submitting: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/reset-password', async () => {
        await delay('infinite')
        return new HttpResponse(null, { status: 204 })
      })
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/new password/i), 'NewPassword1')
    await userEvent.click(canvas.getByRole('button'))

    await waitFor(() => expect(canvas.getByRole('button')).toBeDisabled())
  },
}

export const Success: Story = {
  beforeEach({ msw }) {
    msw.use(http.post('/api/auth/reset-password', () => new HttpResponse(null, { status: 204 })))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/new password/i), 'NewPassword1')
    await userEvent.click(canvas.getByRole('button'))

    await waitFor(() =>
      expect(
        canvas.getByText('Your password has been reset. Please sign in with your new password.')
      ).toBeInTheDocument()
    )
    expect(canvas.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
  },
}

// The single-use consumption on the backend (or a stale/tampered token)
// surfaces as TOKEN_INVALID — same code the missing-token state above
// shows directly, but here it comes back from a real (mocked) round trip.
export const TokenAlreadyUsed: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/reset-password', () =>
        HttpResponse.json(
          { message: 'Invalid or expired token', errorCode: AuthErrorCode.TOKEN_INVALID },
          { status: 401 }
        )
      )
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/new password/i), 'NewPassword1')
    await userEvent.click(canvas.getByRole('button'))

    await waitFor(() =>
      expect(canvas.getByText('This link is invalid or has expired.')).toBeInTheDocument()
    )
  },
}
