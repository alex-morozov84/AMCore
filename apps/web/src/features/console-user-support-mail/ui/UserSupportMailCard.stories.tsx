import type { SupportMailStatus } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { UserSupportMailCard } from './UserSupportMailCard'

const id = '00000000-0000-4000-8000-000000000001'
const attemptId = '00000000-0000-4000-8000-000000000002'
const endpoint = `/api/console/users/${id}/support-mail`
const status: SupportMailStatus = {
  serverNow: '2026-10-24T12:00:00.000Z',
  provider: 'mock',
  actions: ['email_verification', 'password_recovery'].map((kind) => ({
    kind,
    available: true,
    unavailableReason: null,
    retryAfterSeconds: 0,
    latest: null,
    resultExpired: false,
  })) as SupportMailStatus['actions'],
}
const meta = {
  title: 'features/console-user-support-mail/UserSupportMailCard',
  component: UserSupportMailCard,
  args: { actorId: 'operator', userId: id, targetEmail: 'recipient@example.test' },
} satisfies Meta<typeof UserSupportMailCard>
export default meta
type Story = StoryObj<typeof meta>

export const NoHistory: Story = {
  beforeEach({ msw }) {
    msw.use(http.get(endpoint, () => HttpResponse.json(status)))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.findByRole('button', { name: 'Send password recovery email' })
    ).resolves.toBeEnabled()
    expect(canvas.getAllByText('No saved result')).toHaveLength(2)
  },
}
export const Confirmation: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get(endpoint, () => HttpResponse.json(status)),
      http.post(`${endpoint}/prepare`, () =>
        HttpResponse.json({
          attemptId,
          kind: 'password_recovery',
          recipient: 'recipient@example.test',
          expiresAt: '2026-10-24T12:30:00.000Z',
          linkLifetimeSeconds: 900,
        })
      )
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      screen = within(document.body)
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Send password recovery email' })
    )
    const dialog = await screen.findByRole('alertdialog')
    await waitFor(() => expect(within(dialog).getByText(/recipient@example.test/)).toBeVisible())
    expect(within(dialog).getByText(/cancels the previous recovery link/)).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/ }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  },
}
export const Passwordless: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          ...status,
          actions: status.actions.map((action) =>
            action.kind === 'password_recovery'
              ? { ...action, available: false, unavailableReason: 'no_password' }
              : action
          ),
        })
      )
    )
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).findByRole('button', { name: 'Send password recovery email' })
    ).resolves.toBeDisabled()
  },
}
export const UnknownHistory: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          ...status,
          actions: status.actions.map((action) => ({
            ...action,
            latest: {
              evidence: 'stored',
              attemptId,
              kind: action.kind,
              outcome: 'unknown',
              tokenIssued: true,
              provider: 'mock',
              reason: 'deadline',
              attemptedAt: status.serverNow,
              settledAt: status.serverNow,
              readUntil: '2026-10-25T12:00:00.000Z',
            },
          })),
        })
      )
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.findByRole('button', { name: 'Details: Password recovery' })
    ).resolves.toBeVisible()
  },
}
export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get(endpoint, async () => {
        await delay('infinite')
        return HttpResponse.json(status)
      })
    )
  },
}
export const Unavailable: Story = {
  beforeEach({ msw }) {
    msw.use(http.get(endpoint, () => HttpResponse.json({}, { status: 503 })))
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByRole('alert')).resolves.toBeVisible()
  },
}
