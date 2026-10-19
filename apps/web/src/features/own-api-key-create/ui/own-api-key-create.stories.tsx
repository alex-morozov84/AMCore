import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { OwnApiKeyController } from '@/entities/api-key'

import { OwnApiKeyCreate } from './own-api-key-create'

function FormPreview() {
  const [controller] = useState(() => {
    const instance = new OwnApiKeyController(
      { binding: 'a'.repeat(64), actorId: 'preview-owner' },
      {
        verify: async () => ({ verified: true }),
        create: async (_binding, input) => ({
          ...input,
          id: 'preview-key',
          key: '<fake-secret>',
          expiresAt: input.expiresAt ?? null,
          createdAt: '2026-10-19T00:00:00.000Z',
        }),
        list: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
        revoke: async () => ({ revoked: true }),
      }
    )
    instance.setTarget('cmp00000000000000000000000')
    return instance
  })
  return (
    <OwnApiKeyCreate
      controller={controller}
      organizationId="cmp00000000000000000000000"
      organizationName="Acme"
      canCreate
      onInspect={async () => undefined}
    />
  )
}
const meta = { title: 'Features/Own API key creation', component: FormPreview } satisfies Meta<
  typeof FormPreview
>
export default meta
type Story = StoryObj<typeof meta>
export const ScopeSelection: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Create key' }))
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByLabelText('Name')).toBeVisible())
    await expect(within(dialog).getByRole('button', { name: 'Create key' })).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Reporting')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'View the organization' }))
    await expect(within(dialog).getByRole('button', { name: 'Create key' })).toBeEnabled()
  },
}
