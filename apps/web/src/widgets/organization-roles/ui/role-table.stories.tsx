import type { RoleSummary } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { RoleLinkProvider } from '@/shared/lib/role-links'

import { BuiltinRoles } from './builtin-roles'
import { RoleTable } from './role-table'

const role = (over: Partial<RoleSummary> & { id: string; name: string }): RoleSummary => ({
  description: null,
  isSystem: false,
  organizationId: 'organization-example',
  holderCount: 0,
  ruleCount: 0,
  grantsFullControl: false,
  advancedState: 'none',
  ...over,
})
const rows = [
  role({
    id: 'r1',
    name: 'Support agent',
    description: 'Answers customer requests.',
    ruleCount: 1,
    holderCount: 40,
  }),
  role({
    id: 'r2',
    name: 'Team coordinator',
    description:
      'Handles everything that reaches the regional desk, including escalations from partners, and keeps the weekly report current.',
    ruleCount: 2,
    holderCount: 3,
    grantsFullControl: true,
    advancedState: 'present',
  }),
  role({ id: 'r3', name: 'Empty role' }),
]

const meta = {
  title: 'Widgets/Organization roles/Table',
  component: RoleTable,
  args: { rows },
  decorators: [
    (Story) => (
      <RoleLinkProvider roleHref={(id) => `/roles/${id}`}>
        <Story />
      </RoleLinkProvider>
    ),
  ],
} satisfies Meta<typeof RoleTable>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('link', { name: /Open role Support agent/ })[0]).toBeVisible()
    await expect(canvas.getAllByText('Full control')[0]).toBeVisible()
  },
}

export const BuiltIn: StoryObj<typeof BuiltinRoles> = {
  render: () => (
    <BuiltinRoles
      rows={[
        role({ id: 'a', name: 'ADMIN', isSystem: true, organizationId: null, holderCount: 2 }),
        role({ id: 'm', name: 'MEMBER', isSystem: true, organizationId: null, holderCount: 118 }),
      ]}
    />
  ),
}
