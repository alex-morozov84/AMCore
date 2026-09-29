import type { OrgResponse } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { OrganizationSelect } from './organization-select'

const company: OrgResponse = {
  id: 'story-company',
  name: 'Company Alpha',
  slug: 'company-alpha',
  aclVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const meta = {
  title: 'features/organization-select/OrganizationSelect',
  component: OrganizationSelect,
  args: {
    list: { data: [company], total: 1, page: 1, limit: 20 },
    contextHref: (id: string) => `/workspace/${id}`,
    pageHref: (page: number) => `/workspace?page=${page}`,
    dashboardHref: '/',
  },
} satisfies Meta<typeof OrganizationSelect>
export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: company.name })).toBeVisible()
    await expect(canvas.getByRole('link', { name: /Company Alpha/ })).toHaveAttribute(
      'href',
      expect.stringContaining(`/workspace/${company.id}`)
    )
  },
}
export const Empty: Story = { args: { list: { data: [], total: 0, page: 1, limit: 20 } } }
export const Multiple: Story = {
  args: {
    list: {
      data: [
        company,
        {
          ...company,
          id: 'story-beta',
          name: 'Company Beta with a long name for a narrow screen',
          slug: 'company-beta',
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
    },
  },
}
export const Paginated: Story = {
  args: { list: { data: [company], total: 21, page: 2, limit: 20 } },
}
