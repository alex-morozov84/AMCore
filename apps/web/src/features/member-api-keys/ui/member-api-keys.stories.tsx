import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { memberKeyFixture } from './member-key-fixtures'
import { MemberKeyListView } from './member-key-list'
const meta = {
  title: 'Features/Member API keys',
  component: MemberKeyListView,
  args: {
    data: memberKeyFixture,
    status: 'all',
    busy: false,
    onRevoke: () => undefined,
  },
} satisfies Meta<typeof MemberKeyListView>
export default meta
type Story = StoryObj<typeof meta>
export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Daily export')).toBeVisible()
    await userEvent.click(canvas.getByText('Scopes'))
    await expect(canvas.getByText('read:Organization')).toBeVisible()
  },
}
export const Empty: Story = {
  args: { data: { ...memberKeyFixture, data: [], total: 0, revocableCount: 0 } },
}
export const Revoked: Story = {
  args: {
    data: {
      ...memberKeyFixture,
      revocableCount: 0,
      data: [
        {
          ...memberKeyFixture.data[0]!,
          status: 'revoked',
          revokedAt: '2026-10-18T10:00:00.000Z',
          revocationReason: 'organization_admin_revoked',
        },
      ],
    },
  },
}

export const Expired: Story = {
  args: {
    data: {
      ...memberKeyFixture,
      data: [
        { ...memberKeyFixture.data[0]!, status: 'expired', expiresAt: '2026-10-17T10:00:00.000Z' },
      ],
    },
  },
}
