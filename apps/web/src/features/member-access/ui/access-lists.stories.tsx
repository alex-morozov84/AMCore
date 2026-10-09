import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import type { AccessLabels } from '../model/use-access-labels'

import { AccessInactive, AccessItems } from './access-lists'

const refs = (...ids: string[]) => ({ roleIds: ids, total: ids.length })
const area = (kind: 'all' | 'assigned' | 'own' | 'custom', over = {}) => ({
  kind,
  roles: refs('manager'),
  fields: null,
  prerequisite: 'met' as const,
  masked: false,
  absorbed: false,
  ...over,
})
const configured = (key: string, over = {}) => ({
  key,
  evaluation: 'configured' as const,
  baseline: false as const,
  state: 'configured' as const,
  areas: [area('assigned')],
  limits: [],
  blockedBy: null,
  sources: [],
  sourcesTruncated: false,
  ...over,
})

const capabilities = Array.from({ length: 40 }, (_, index) => ({
  id: `shop${index % 4}.op${index}`,
  subject: `Shop${index % 4}`,
  action: 'update',
  operation: `op${index}`,
  method: 'PATCH',
  path: '/x',
  labelKey: `op${index}`,
  credentials: ['bearer'],
  presets: ['own', 'assigned', 'all'],
  editableFields: [],
})) as never

const labels: AccessLabels = {
  fieldLabel: (field) => field,
  labelOf: (key) => `Capability ${key}`,
}
const nameOf = (id: string) => (id === 'manager' ? 'Manager' : 'Auditor')

const meta = {
  title: 'Features/Member access/Access lists',
  component: AccessItems,
  args: { capabilities, labels, nameOf },
} satisfies Meta<typeof AccessItems>
export default meta
type Story = StoryObj<typeof meta>

/** What a registered capability looks like: areas, a prerequisite it cannot prove, a limit, a block. */
export const Configured: Story = {
  args: {
    parts: {
      active: [
        configured('shop0.op0', {
          areas: [area('assigned'), area('own', { roles: refs('support') })],
        }),
        configured('shop1.op1', {
          areas: [area('assigned', { prerequisite: 'unproven' })],
          limits: [{ kind: 'denyCondition' }],
        }),
        configured('shop2.op2', {
          state: 'blocked',
          areas: [area('own', { masked: true })],
          blockedBy: refs('auditor'),
        }),
        configured('shop3.op3', { state: 'allowed', areas: [area('all')] }),
      ],
      inactive: [],
      notEvaluated: [],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/does not check a specific record/i)).toBeVisible()
    await expect(canvas.getAllByText('Configured').length).toBeGreaterThan(0)
  },
}

/** A long list gains a search and collapsible areas. */
export const LongList: Story = {
  args: {
    parts: {
      active: Array.from({ length: 30 }, (_, index) => configured(`shop${index % 4}.op${index}`)),
      inactive: [],
      notEvaluated: [],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: /search the list/i }), 'op17')
    await expect(canvasElement.querySelectorAll('details[open]')).toHaveLength(1)
  },
}

export const NotEvaluated: StoryObj<typeof AccessInactive> = {
  render: () => (
    <AccessInactive
      capabilities={capabilities}
      labels={labels}
      parts={{
        active: [],
        inactive: [],
        notEvaluated: [
          {
            key: 'shop0.op0',
            evaluation: 'notEvaluated',
            baseline: false,
            reason: 'optOut',
            sources: [],
            sourcesTruncated: false,
          },
        ],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Not evaluated \(1\)/)).toBeVisible()
  },
}
