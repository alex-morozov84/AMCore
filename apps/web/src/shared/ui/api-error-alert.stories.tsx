import { AuthErrorCode } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { ApiNetworkError, ApiRequestError } from '../api/http-client'

import { ApiErrorAlert } from './api-error-alert'

const meta = {
  title: 'shared/ui/ApiErrorAlert',
  component: ApiErrorAlert,
} satisfies Meta<typeof ApiErrorAlert>

export default meta
type Story = StoryObj<typeof meta>

// `.storybook/preview.tsx`'s global NextIntlClientProvider (en messages)
// supplies the translations `useApiError()` reads — no per-story provider
// needed. Mirrors api-error-alert.test.tsx's cases.

export const NoError: Story = {
  args: { error: null },
}

export const KnownErrorCode: Story = {
  args: {
    error: new ApiRequestError(401, {
      message: 'Invalid credentials',
      errorCode: AuthErrorCode.INVALID_CREDENTIALS,
    } as never),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The backend's own English message must never reach the user — this
    // is the defect ADR-023 exists to prevent.
    await expect(canvas.getByText('Incorrect email or password.')).toBeInTheDocument()
    expect(canvas.queryByText(/Invalid credentials/)).not.toBeInTheDocument()
  },
}

export const UnknownErrorCode: Story = {
  args: {
    error: new ApiRequestError(500, {
      message: 'Some internal detail',
      errorCode: 'SOMETHING_THE_CLIENT_HAS_NEVER_HEARD_OF',
      correlationId: 'abc-123',
    } as never),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(canvas.getByText('Reference: abc-123')).toBeInTheDocument()
  },
}

export const NetworkError: Story = {
  args: {
    error: new ApiNetworkError(new TypeError('Failed to fetch')),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText("Can't reach the server. Check your connection and try again.")
    ).toBeInTheDocument()
  },
}
