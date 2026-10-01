import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { OrganizationContextSummary } from './organization-context-summary'

const meta = {
  title: 'widgets/organization-context-summary/OrganizationContextSummary',
  component: OrganizationContextSummary,
  args: {
    email: 'user@example.com',
    context: {
      organization: {
        id: 'story-company',
        name: 'Company Alpha',
        slug: 'company-alpha',
      },
      canManageTeamAccess: true,
      actorAffordances: {
        'teamAccess.manage': 'allowed',
        'organization.read': 'allowed',
        'organization.update': 'recordRequired',
        'organization.delete': 'recordRequired',
      },
      recordAffordances: {
        'organization.read': { allowed: true, fields: {} },
        'organization.update': { allowed: false, fields: { name: false, slug: false } },
        'organization.delete': { allowed: false, fields: {} },
      },
    },
  },
} satisfies Meta<typeof OrganizationContextSummary>
export default meta
type Story = StoryObj<typeof meta>
export const Allowed: Story = {}
export const Denied: Story = {
  args: {
    context: {
      ...meta.args.context,
      canManageTeamAccess: false,
      actorAffordances: { ...meta.args.context.actorAffordances, 'teamAccess.manage': 'denied' },
    },
  },
}
