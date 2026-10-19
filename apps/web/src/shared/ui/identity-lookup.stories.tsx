import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { IdentityLookup } from './identity-lookup'

const meta = {
  title: 'shared/ui/IdentityLookup',
  component: IdentityLookup,
  args: {
    inputId: 'identity-lookup',
    label: 'Search user',
    copy: {
      lookupSearch: 'At least 2 characters',
      lookupEmpty: 'Nothing found',
      lookupSelect: 'Select record',
      lookupError: 'Search unavailable',
      lookupRefine: 'Refine search',
      loading: 'Loading',
    },
    searchItems: async () => ({
      items: [{ id: 'example', name: 'Ada', email: 'ada@example.test' }],
      hasMore: false,
    }),
    onSelect: () => undefined,
  },
} satisfies Meta<typeof IdentityLookup>
export default meta
type Story = StoryObj<typeof meta>

export const NamedResult: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'Ada{Enter}')
    const result = await canvas.findByRole('button')
    await expect(result).toHaveAccessibleName('Select record: Ada ada@example.test')
    await expect(result).toHaveTextContent('Ada')
    await expect(result).toHaveTextContent('ada@example.test')
  },
}
