import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from './combobox'

const collections = ['Documents', 'Reports', 'Settings']
function CollectionSelect({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<string | null>(null)
  return (
    <Combobox items={collections} value={value} onValueChange={setValue} disabled={disabled}>
      <ComboboxTrigger aria-label="Collection">{value ?? 'Select a collection'}</ComboboxTrigger>
      <ComboboxContent aria-label="Choose a collection">
        <ComboboxInput aria-label="Search collections" />
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
const meta = {
  title: 'shared/ui/Combobox',
  component: CollectionSelect,
} satisfies Meta<typeof CollectionSelect>
export default meta
type Story = StoryObj<typeof meta>
export const SearchAndKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Collection'))
    const popup = within(canvasElement.ownerDocument.body)
    await userEvent.type(popup.getByLabelText('Search collections'), 'Reports')
    await expect(popup.getAllByRole('option')).toHaveLength(1)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(canvas.getByLabelText('Collection')).toHaveTextContent('Reports')
  },
}
export const Disabled: Story = { args: { disabled: true } }
