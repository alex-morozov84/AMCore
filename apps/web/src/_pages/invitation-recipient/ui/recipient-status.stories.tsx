import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import messages from '../../../../messages/en.json'

import { RecipientStatus } from './recipient-status'

const meta = {
  title: 'pages/invitation-recipient/Status', component: RecipientStatus,
  parameters: { messages: { invitationRecipient: messages.invitationRecipient, errors: messages.errors } },
  args: { state: 'unusable', onLeave: fn() },
} satisfies Meta<typeof RecipientStatus>
export default meta
type Story = StoryObj<typeof meta>

export const Unusable: Story = {}
export const Authenticating: Story = { args: { state: 'authenticating' } }
export const VerifyEmail: Story = { args: { state: 'verify_email', email: 'invited@example.test', busy: false,
  onRefresh: fn(), onResend: fn() } }
export const WrongAccount: Story = { args: { state: 'wrong_account', email: 'own-account@example.test', busy: false, onSwitch: fn() } }
export const CompletingSignIn: Story = {
  args: { state: 'completing_signin', busy: false, onConfirm: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    if (args.state !== 'completing_signin') throw new Error('Expected completing-sign-in fixture')
    await expect(args.onConfirm).not.toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: messages.invitationRecipient.confirmSignIn }))
    await expect(args.onConfirm).toHaveBeenCalledOnce()
  },
}
export const AlreadyAccess: Story = { args: { state: 'already_access', organization: 'Example organization', onOpen: fn() } }
export const Joined: Story = { args: { state: 'joined', organization: 'Example organization', onOpen: fn() } }
export const RemovedAccess: Story = {
  args: { state: 'access_removed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: messages.invitationRecipient.accept })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: messages.invitationRecipient.openOrganization })).not.toBeInTheDocument()
  },
}
