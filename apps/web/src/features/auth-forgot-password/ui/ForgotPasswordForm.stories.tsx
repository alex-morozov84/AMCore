import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ForgotPasswordForm } from './ForgotPasswordForm'

const meta = {
  title: 'features/auth-forgot-password/ForgotPasswordForm',
  component: ForgotPasswordForm,
} satisfies Meta<typeof ForgotPasswordForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Submitting: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/forgot-password', async () => {
        await delay('infinite')
        return HttpResponse.json({ message: 'unused' })
      })
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/email/i), 'user@amcore.dev')
    await userEvent.click(canvas.getByRole('button'))

    await waitFor(() => expect(canvas.getByRole('button')).toBeDisabled())
  },
}

// Real BFF mutation — POST /api/auth/forgot-password always returns the
// same enumeration-safe 200 regardless of whether the account exists. The
// form never renders the backend's own `message` (English, developer-
// facing) — this is the frontend's own translated confirmation copy,
// swapped in for the form on success.
export const Success: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/forgot-password', () =>
        HttpResponse.json({ message: 'If an account with that email exists, ...' })
      )
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/email/i), 'user@amcore.dev')
    await userEvent.click(canvas.getByRole('button'))

    await waitFor(() =>
      expect(
        canvas.getByText(
          "If an account with that email exists, we've sent a link to reset your password."
        )
      ).toBeInTheDocument()
    )
    expect(canvas.queryByRole('button')).not.toBeInTheDocument()
  },
}
