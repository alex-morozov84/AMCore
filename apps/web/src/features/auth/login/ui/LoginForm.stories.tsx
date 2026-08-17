import { AuthErrorCode } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { LoginForm } from './LoginForm'

const meta = {
  title: 'features/auth/login/LoginForm',
  component: LoginForm,
} satisfies Meta<typeof LoginForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

// Real BFF mutation, not a client-side-only check — POST /api/auth/login,
// mocked via msw-storybook-addon (parameters/loaders wired in
// .storybook/preview.tsx). A held-open response keeps `isPending` true long
// enough to assert the button's own loading copy actually renders.
export const Submitting: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/login', async () => {
        await delay('infinite')
        return HttpResponse.json({})
      })
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/email/i), 'user@amcore.dev')
    await userEvent.type(canvas.getByLabelText(/password/i), 'hunter2hunter2')
    await userEvent.click(canvas.getByRole('button'))

    await waitFor(() => expect(canvas.getByRole('button')).toBeDisabled())
  },
}

export const InvalidCredentials: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          { message: 'Invalid credentials', errorCode: AuthErrorCode.INVALID_CREDENTIALS },
          { status: 401 }
        )
      )
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/email/i), 'user@amcore.dev')
    await userEvent.type(canvas.getByLabelText(/password/i), 'wrong-password')
    await userEvent.click(canvas.getByRole('button'))

    // Translated by errorCode, never the backend's English message — see
    // shared/ui/api-error-alert.stories.tsx.
    await waitFor(() =>
      expect(canvas.getByText('Incorrect email or password.')).toBeInTheDocument()
    )
  },
}
