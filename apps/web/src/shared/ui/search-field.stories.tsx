import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { SearchField } from './search-field'

const meta = {
  title: 'shared/ui/SearchField',
  component: SearchField,
  args: {
    id: 'catalog-search',
    name: 'query',
    value: '',
    label: 'Search catalogue',
    placeholder: 'Name or code',
    clearLabel: 'Clear catalogue search',
    onValueChange: () => undefined,
    onClear: () => undefined,
  },
} satisfies Meta<typeof SearchField>

export default meta
type Story = StoryObj<typeof meta>

function ControlledField({ initialValue = '' }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue)
  return (
    <SearchField
      {...meta.args}
      value={value}
      onValueChange={setValue}
      onClear={() => setValue('')}
      className="w-96"
    />
  )
}

export const Empty: Story = { render: () => <ControlledField /> }

export const Populated: Story = {
  render: () => <ControlledField initialValue="Acme" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Clear catalogue search' }))
    await expect(canvas.getByLabelText('Search catalogue')).toHaveFocus()
    await expect(canvas.queryByRole('button', { name: 'Clear catalogue search' })).toBeNull()
  },
}
