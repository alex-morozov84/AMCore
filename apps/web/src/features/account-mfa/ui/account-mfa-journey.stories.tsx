import { useState } from 'react'
import type { MfaBrowserView } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'

import { AccountMfaController } from '../model/account-mfa-controller'

import { AccountMfaJourney } from './account-mfa-journey'

function Preview({ view }: { view: MfaBrowserView }) {
  const [controller] = useState(
    () =>
      new AccountMfaController({
        inspect: async () => view,
        command: async () => ({ view }),
      })
  )
  return (
    <AccountMfaJourney
      controller={controller}
      onExit={() => {}}
      onComplete={() => {}}
      passwordRecoveryHref="/forgot-password"
    />
  )
}
const meta = {
  title: 'Features/Account sign-in protection',
  component: Preview,
} satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>
export const Unavailable: Story = {
  args: { view: { kind: 'unavailable' } },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[aria-busy="true"]')).toBeNull())
    await expect(await within(canvasElement).findByRole('status')).toBeVisible()
  },
}
export const PasswordSetup: Story = {
  args: { view: { kind: 'password_setup_required', accountLabel: 'Demo operator' } },
  play: async ({ canvasElement }) => {
    const link = await within(canvasElement).findByRole('link')
    await expect(link.getAttribute('href')).toMatch(/\/forgot-password$/)
  },
}
export const EmergencyRecovery: Story = {
  args: { view: { kind: 'recovery_ticket', accountLabel: 'Demo operator' } },
}
export const Settings: Story = {
  args: {
    view: {
      kind: 'settings',
      accountLabel: 'Demo operator',
      eligible: true,
      protected: true,
      remainingCodes: 0,
    },
  },
}
export const Expired: Story = {
  args: {
    view: {
      kind: 'flow',
      state: 'expired',
      purpose: 'login',
      accountLabel: 'Demo operator',
      expiresAt: '2026-01-01T00:00:00.000Z',
      requiredProofs: [],
      generation: 1,
      remainingCodes: 0,
    },
  },
}
