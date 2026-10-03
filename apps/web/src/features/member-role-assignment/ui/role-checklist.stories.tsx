import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { RoleChecklist } from './role-checklist'

const roles = [
  { id: 'admin', name: 'ADMIN', description: null, isSystem: true },
  { id: 'member', name: 'MEMBER', description: null, isSystem: true },
  {
    id: 'editor',
    name: 'Product editor',
    description: 'Maintains product content',
    isSystem: false,
  },
]
const meta = {
  title: 'features/member-role-assignment/RoleChecklist',
  component: RoleChecklist,
  args: { roles, selected: ['admin'], disabled: false, readOnly: false, onChange: () => undefined },
} satisfies Meta<typeof RoleChecklist>
export default meta
type Story = StoryObj<typeof meta>
function EditableChecklist() {
  const [selected, setSelected] = useState(['admin'])
  return <RoleChecklist {...meta.args} selected={selected} onChange={setSelected} />
}
export const Editable: Story = {
  render: () => <EditableChecklist />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('checkbox', { name: 'ADMIN' })).toBeChecked()
    await userEvent.click(canvas.getByRole('checkbox', { name: 'MEMBER' }))
    await expect(canvas.getByRole('checkbox', { name: 'MEMBER' })).toBeChecked()
    await expect(canvas.getByRole('checkbox', { name: 'ADMIN' })).toBeChecked()
  },
}
export const Pending: Story = { args: { disabled: true } }
export const ReadOnlyRecovery: Story = { args: { readOnly: true } }
export const EmptyChoices: Story = { args: { roles: [] } }
