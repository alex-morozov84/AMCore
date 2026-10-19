import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { RoleLinkProvider } from '@/shared/lib/role-links'

import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'

import { RoleChecklist } from './role-checklist'

const meta = {
  title: 'shared/ui/RoleChecklist',
  component: RoleChecklist,
  decorators: [
    (Story) => (
      <RoleLinkProvider roleHref={(id) => `/organizations/example/roles/${id}`}>
        <Story />
      </RoleLinkProvider>
    ),
  ],
  args: {
    roles: [{ id: 'admin', name: 'ADMIN', description: null, isSystem: true }],
    selected: [],
    disabled: false,
    readOnly: false,
    onChange: () => undefined,
  },
} satisfies Meta<typeof RoleChecklist>
export default meta
type Story = StoryObj<typeof meta>

function linkedStory(copy: typeof en.organizationInvitations): Story {
  return {
    args: {
      labels: {
        system: copy.system,
        custom: copy.custom,
        noDescription: copy.noDescription,
        empty: copy.emptyRoles,
        details: copy.roleDetails,
        detailsFor: (name) => copy.roleDetailsFor.replace('{name}', name),
      },
    },
    play: async ({ canvasElement }) => {
      const link = within(canvasElement).getByRole('link')
      await expect(link).toHaveTextContent(copy.roleDetails)
      await expect(link).toHaveAccessibleName(
        `${copy.roleDetails}: ${copy.roleDetailsFor.replace('{name}', 'ADMIN')}`
      )
      await expect(link).toHaveAttribute('target', '_blank')
    },
  }
}

export const EnglishLinks: Story = linkedStory(en.organizationInvitations)
export const RussianLinks: Story = linkedStory(ru.organizationInvitations)
