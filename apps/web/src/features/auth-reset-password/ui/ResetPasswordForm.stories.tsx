import { AuthErrorCode } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import messages from '../../../../messages/en.json'

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
    await userEvent.type(
      canvas.getByLabelText(messages.auth.newPassword, { exact: true }),
      'NewPassword1'
    )
    const submit = canvas.getByRole('button', {
      name: messages.auth.resetPasswordSubmit,
    })
    await userEvent.click(submit)

    await waitFor(() => expect(submit).toBeDisabled())
  },
}

export const Success: Story = {
  beforeEach({ msw }) {
    msw.use(http.post('/api/auth/reset-password', () => new HttpResponse(null, { status: 204 })))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByLabelText(messages.auth.newPassword, { exact: true }),
      'NewPassword1'
    )
    const submit = canvas.getByRole('button', {
      name: messages.auth.resetPasswordSubmit,
    })
    await userEvent.click(submit)

    await waitFor(() =>
      expect(canvas.getByText(messages.auth.resetPasswordSuccess)).toBeInTheDocument()
    )
    expect(canvas.getByRole('link', { name: messages.auth.login })).toBeInTheDocument()
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
    await userEvent.type(
      canvas.getByLabelText(messages.auth.newPassword, { exact: true }),
      'NewPassword1'
    )
    const submit = canvas.getByRole('button', {
      name: messages.auth.resetPasswordSubmit,
    })
    await userEvent.click(submit)

    await waitFor(() => expect(canvas.getByText(messages.errors.TOKEN_INVALID)).toBeInTheDocument())
  },
}
