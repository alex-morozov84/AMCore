import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import messages from '../../../../messages/en.json'

import { InvitationConsent } from './invitation-consent'
import { readyInvitation } from './invitation-consent.fixture'

const meta = {
  title: 'features/invitation-acceptance/InvitationConsent',
  component: InvitationConsent,
  parameters: {
    messages: { invitationRecipient: messages.invitationRecipient, errors: messages.errors },
  },
  args: {
    invitation: readyInvitation,
    accountEmail: 'person@example.test',
    timeZone: 'UTC',
    state: 'idle',
    onAccept: fn(),
    onRecover: fn(),
    onLeave: fn(),
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-md rounded-lg border bg-card p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InvitationConsent>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: messages.invitationRecipient.accept })
    )
    await expect(args.onAccept).toHaveBeenCalledOnce()
    await expect(args.onRecover).not.toHaveBeenCalled()
  },
}
export const Pending: Story = { args: { state: 'pending' } }
export const UnknownOutcome: Story = {
  args: { state: 'unknown' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: messages.invitationRecipient.accept })
    ).toBeDisabled()
    await userEvent.click(
      canvas.getByRole('button', { name: messages.invitationRecipient.recover })
    )
    await expect(args.onRecover).toHaveBeenCalledOnce()
    await expect(args.onAccept).not.toHaveBeenCalled()
  },
}
