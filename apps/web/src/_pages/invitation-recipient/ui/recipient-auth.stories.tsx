import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import messages from '../../../../messages/en.json'

import { RecipientAuth } from './recipient-auth'

const meta = {
  title: 'pages/invitation-recipient/Authentication',
  component: RecipientAuth,
  parameters: {
    messages: {
      common: messages.common,
      auth: messages.auth,
      errors: messages.errors,
      validation: messages.validation,
      invitationRecipient: messages.invitationRecipient,
    },
  },
  args: {
    email: 'invited@example.test',
    busy: false,
    login: {
      submit: fn(() => new Promise<never>(() => {})),
      isCurrent: () => true,
      onSuccess: fn(),
    },
    register: {
      submit: fn(() => new Promise<never>(() => {})),
      isCurrent: () => true,
      onSuccess: fn(),
    },
    oauth: { providers: ['google', 'github', 'apple'], onChoose: fn() },
    onLeave: fn(),
  },
} satisfies Meta<typeof RecipientAuth>
export default meta
type Story = StoryObj<typeof meta>

export const SignIn: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText(messages.auth.email)).toHaveValue(args.email)
    await expect(args.login.submit).not.toHaveBeenCalled()
    await expect(args.register.submit).not.toHaveBeenCalled()
  },
}
export const FixedEmailRegistration: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: messages.auth.register }))
    const registration = within(canvas.getByRole('tabpanel', { name: messages.auth.register }))
    await expect(registration.getByLabelText(messages.auth.email)).toHaveValue(args.email)
    await expect(registration.getByLabelText(messages.auth.email)).toHaveAttribute('readonly')
    await expect(
      canvas.getByRole('tabpanel', { name: messages.auth.register })
    ).toHaveAccessibleName(messages.auth.register)
    await expect(args.register.submit).not.toHaveBeenCalled()
  },
}
export const ExplicitOAuth: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: messages.auth.continueWithGoogle }))
    await expect(args.oauth.onChoose).toHaveBeenCalledWith('google')
  },
}
export const Busy: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('tab', { name: messages.auth.register })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    await expect(canvas.getByRole('button', { name: messages.auth.login })).toBeDisabled()
    await expect(
      canvas.getByRole('button', { name: messages.invitationRecipient.leave })
    ).toBeEnabled()
  },
}
