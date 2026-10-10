import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { Checkbox } from '@/shared/ui/checkbox'
import { FilterButtons } from '@/shared/ui/filter-buttons'

function SelectionFixture({ dark = false }: { dark?: boolean }) {
  return (
    <div className={dark ? 'dark' : ''}>
      <div className="flex gap-4 bg-background p-4 text-foreground [--selection:var(--console-accent)] [--selection-foreground:var(--console-accent-foreground)]">
        <Checkbox aria-label="Selected task" checked />
        <Checkbox aria-label="Mixed selection" indeterminate />
        <FilterButtons
          label="Task state"
          value="failed"
          options={[{ value: 'failed', label: 'Failed' }]}
          onChange={() => {}}
        />
      </div>
    </div>
  )
}

const meta = {
  title: 'features/Console background work/Selection',
  component: SelectionFixture,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const checked = canvas.getByRole('checkbox', { name: 'Selected task' })
    const mixed = canvas.getByRole('checkbox', { name: 'Mixed selection' })
    const filter = canvas.getByRole('button', { name: 'Failed' })
    await expect(checked).toBeChecked()
    await expect(mixed).toHaveAttribute('aria-checked', 'mixed')
    await expect(mixed).toHaveAttribute('data-indeterminate')
    for (const element of [checked, mixed]) {
      await expect(getComputedStyle(element).backgroundColor).toBe(
        getComputedStyle(filter).backgroundColor
      )
      await expect(getComputedStyle(element).color).toBe(getComputedStyle(filter).color)
    }
  },
} satisfies Meta<typeof SelectionFixture>
export default meta
type Story = StoryObj<typeof meta>
export const Light: Story = {}
export const Dark: Story = { args: { dark: true } }
