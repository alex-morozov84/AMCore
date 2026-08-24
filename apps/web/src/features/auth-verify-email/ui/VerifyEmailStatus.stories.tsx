import { AuthErrorCode } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, waitFor, within } from 'storybook/test'

import { VerifyEmailStatus } from './VerifyEmailStatus'

const meta = {
  title: 'features/auth-verify-email/VerifyEmailStatus',
  component: VerifyEmailStatus,
  args: {
    token: 'a'.repeat(64),
  },
} satisfies Meta<typeof VerifyEmailStatus>

export default meta
type Story = StoryObj<typeof meta>

// The route file only ever passes an absent `token` when the page was
// opened without the emailed `?token=`. No mutation ever fires — `useCurrentUser()`
// is still mocked below since the component reads it unconditionally.
export const InvalidLink: Story = {
  beforeEach({ msw }) {
    msw.use(http.get('/api/auth/me', () => HttpResponse.json({ user: null })))
  },
  args: {
    token: undefined,
  },
}

export const Verifying: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/verify-email', async () => {
        await delay('infinite')
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('/api/auth/me', () => HttpResponse.json({ user: null }))
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText(/Verifying your email/)).toBeInTheDocument())
  },
}

export const SuccessAnonymous: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/verify-email', () => new HttpResponse(null, { status: 204 })),
      http.get('/api/auth/me', () => HttpResponse.json({ user: null }))
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByText('Your email address has been verified.')).toBeInTheDocument()
    )
    expect(canvas.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
  },
}

// Verifying a second, still-open tab while already signed in — the success
// CTA sends a logged-in visitor straight to the dashboard instead of login.
export const SuccessSignedIn: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/verify-email', () => new HttpResponse(null, { status: 204 })),
      http.get('/api/auth/me', () =>
        HttpResponse.json({
          user: {
            id: 'u1',
            email: 'user@amcore.dev',
            emailVerified: true,
            name: 'Ada Lovelace',
            avatarUrl: null,
            phone: null,
            locale: 'en',
            timezone: 'UTC',
            createdAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
          },
        })
      )
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByRole('link', { name: /go to dashboard/i })).toBeInTheDocument()
    )
  },
}

// The single-use consumption on the backend (or a stale/tampered token)
// surfaces as TOKEN_INVALID — same failure `ResetPasswordForm`'s
// `TokenAlreadyUsed` story covers for the sibling flow.
export const Failed: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/auth/verify-email', () =>
        HttpResponse.json(
          { message: 'Invalid or expired token', errorCode: AuthErrorCode.TOKEN_INVALID },
          { status: 401 }
        )
      ),
      http.get('/api/auth/me', () => HttpResponse.json({ user: null }))
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByText('This link is invalid or has expired.')).toBeInTheDocument()
    )
    expect(canvas.getByRole('link', { name: /resend verification/i })).toBeInTheDocument()
  },
}
