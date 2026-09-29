import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { BackLink } from './back-link'

const meta = {
  title: 'shared/ui/BackLink',
  component: BackLink,
} satisfies Meta<typeof BackLink>

export default meta
type Story = StoryObj<typeof meta>

export const OrganizationList: Story = {
  args: { href: '/organizations?view=list', children: 'All organizations' },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'All organizations' })
    await expect(link).toHaveAttribute('href', '/en/organizations?view=list')
    await expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  },
}
