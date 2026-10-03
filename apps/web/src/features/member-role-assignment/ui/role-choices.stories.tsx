import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { RoleChoices } from './role-choices'

const meta = {
  title: 'features/member-role-assignment/RoleChoices',
  component: RoleChoices,
  args: {
    roles: [],
    selected: [],
    disabled: false,
    readOnly: false,
    onChange: () => undefined,
    pending: false,
    onRetry: () => undefined,
  },
} satisfies Meta<typeof RoleChoices>
export default meta
type Story = StoryObj<typeof meta>
export const Loading: Story = {
  args: { pending: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toBeInTheDocument()
    await expect(canvasElement.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  },
}
export const ManyRoles: Story = {
  args: {
    roles: Array.from({ length: 20 }, (_, i) => ({
      id: `role-${i}`,
      name: `Role ${i + 1}`,
      description: `Description ${i + 1}`,
      isSystem: false,
    })),
  },
}
export const Unavailable: Story = { args: { unavailable: true } }
export const Empty: Story = {}
