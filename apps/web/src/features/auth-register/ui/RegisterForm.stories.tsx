import { AuthErrorCode } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { RegisterForm } from './RegisterForm'

const meta = {
  title: 'features/auth-register/RegisterForm',
  component: RegisterForm,
} satisfies Meta<typeof RegisterForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Submitting: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/register', async () => {
        await delay('infinite')
        return HttpResponse.json({})
      })
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/name/i), 'Jane Doe')
    await userEvent.type(canvas.getByLabelText(/email/i), 'jane@amcore.dev')
    await userEvent.type(canvas.getByLabelText(/password/i), 'Correct1Horse')
    await userEvent.click(canvas.getByRole('button'))

    await waitFor(() => expect(canvas.getByRole('button')).toBeDisabled())
  },
}

// A real BFF conflict response — email already taken.
export const EmailAlreadyExists: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json(
          { message: 'Email already in use', errorCode: AuthErrorCode.EMAIL_ALREADY_EXISTS },
          { status: 409 }
        )
      )
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/name/i), 'Jane Doe')
    await userEvent.type(canvas.getByLabelText(/email/i), 'jane@amcore.dev')
    await userEvent.type(canvas.getByLabelText(/password/i), 'Correct1Horse')
    await userEvent.click(canvas.getByRole('button'))

    await waitFor(() =>
      expect(canvas.getByText('An account with this email already exists.')).toBeInTheDocument()
    )
  },
}
