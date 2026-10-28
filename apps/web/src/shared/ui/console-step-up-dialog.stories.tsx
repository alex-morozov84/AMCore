import { NextIntlClientProvider } from 'next-intl'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'

import { ConsoleStepUpDialog } from './console-step-up-dialog'

const flow = {
  kind: 'proof_required' as const,
  flowBinding: '11111111-1111-4111-8111-111111111111',
  expiresAt: '2099-01-01T00:00:00.000Z',
  requiredProofs: ['second_factor' as const],
}
const meta = {
  title: 'shared/ui/ConsoleStepUpDialog',
  component: ConsoleStepUpDialog,
  args: { phase: { kind: 'proof', flow }, isSubmitting: false, onSubmit: fn(), onClose: fn() },
} satisfies Meta<typeof ConsoleStepUpDialog>
export default meta
type Story = StoryObj<typeof meta>

export const AppThenBackup: Story = {
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(await body.findByLabelText(en.accountMfa.appCode), '123456')
    await userEvent.click(body.getByRole('button', { name: en.accountMfa.continue }))
    await expect(args.onSubmit).toHaveBeenCalledWith({ method: 'totp', code: '123456' })
    await userEvent.click(body.getByRole('button', { name: en.accountMfa.noApp }))
    await userEvent.type(body.getByLabelText(en.accountMfa.backupCode), 'f'.repeat(32))
    await userEvent.click(body.getByRole('button', { name: en.accountMfa.continue }))
    await expect(args.onSubmit).toHaveBeenCalledWith({
      method: 'recovery_code',
      code: 'f'.repeat(32),
    })
  },
}
export const RussianUnknown: Story = {
  args: { phase: { kind: 'proof', flow, unknown: true } },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="ru" messages={ru}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getByText(ru.accountMfa.unknownCodeWarning)).toBeVisible())
    await expect(body.queryByLabelText(ru.accountMfa.appCode)).toBeNull()
    await userEvent.click(body.getByRole('button', { name: ru.accountMfa.checkResult }))
    await expect(args.onSubmit).toHaveBeenCalledWith(null)
  },
}
