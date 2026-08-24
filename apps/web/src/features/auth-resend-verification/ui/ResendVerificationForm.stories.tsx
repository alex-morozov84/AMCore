import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ResendVerificationForm } from './ResendVerificationForm'

const meta = {
  title: 'features/auth-resend-verification/ResendVerificationForm',
  component: ResendVerificationForm,
} satisfies Meta<typeof ResendVerificationForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Submitting: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/resend-verification', async () => {
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

// Same enumeration-safe pattern as ForgotPasswordForm — see its Success
// story for the reasoning.
export const Success: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/resend-verification', () =>
        HttpResponse.json({ message: 'If the account exists and is unverified, ...' })
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
          "If the account exists and isn't verified yet, we've sent a new verification link."
        )
      ).toBeInTheDocument()
    )
    expect(canvas.queryByRole('button')).not.toBeInTheDocument()
  },
}
