import { type ComponentProps, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import messages from '../../../messages/en.json'

import { LocaleSelector } from './locale-selector'

function Controlled(args: ComponentProps<typeof LocaleSelector>) {
  const [value, setValue] = useState(args.value)
  return (
    <LocaleSelector
      {...args}
      value={value}
      onChange={(next) => {
        setValue(next)
        args.onChange(next)
      }}
    />
  )
}

const meta = {
  title: 'shared/ui/LocaleSelector',
  component: LocaleSelector,
  render: Controlled,
  args: {
    label: 'Language',
    items: [
      { value: 'en', label: 'English' },
      { value: 'ru', label: messages.locale.ru },
    ],
    value: 'en',
    pending: false,
    onChange: fn(),
  },
} satisfies Meta<typeof LocaleSelector>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const select = within(canvasElement).getByRole('combobox', { name: 'Language' })
    await userEvent.selectOptions(select, 'ru')
    await expect(select).toHaveValue('ru')
    await expect(args.onChange).toHaveBeenCalledWith('ru')
  },
}

export const Pending: Story = { args: { value: 'ru', pending: true } }

export const ThirdLongLabel: Story = {
  args: {
    value: 'de',
    items: [
      { value: 'en', label: 'English' },
      { value: 'ru', label: messages.locale.ru },
      { value: 'de', label: 'Additional language with a very long display name' },
    ],
  },
}
