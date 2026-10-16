import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import messages from '../../../../messages/en.json'

import { OrganizationCreate } from './organization-create'

type Flow = ComponentProps<typeof OrganizationCreate>['flow']
const attempt = {
  version: 1 as const,
  binding: 'a'.repeat(64),
  actorId: 'actor',
  input: { operationId: '10000000-0000-4000-8000-000000000001', name: 'Example company' },
}
function flow(
  state: Flow['state'] = { phase: 'idle', storageAvailable: true },
  enabled = true
): Flow {
  return {
    state,
    blocksAutoOpen: !!state.attempt,
    controller: {
      submit: fn(),
      check: fn(),
      repeat: fn(),
      dismiss: fn(),
    },
    policy: {
      data: { selfServiceCreationEnabled: enabled },
      isPending: false,
      isError: false,
      refetch: fn(),
    },
  } as unknown as Flow
}
const meta = {
  title: 'features/organization-create/Organization creation',
  component: OrganizationCreate,
  args: { flow: flow(), onOpen: fn() },
} satisfies Meta<typeof OrganizationCreate>
export default meta
type Story = StoryObj<typeof meta>
export const Ready: Story = {}
export const Disabled: Story = { args: { flow: flow(undefined, false) } }
export const Unknown: Story = {
  args: { flow: flow({ phase: 'unknown', attempt, storageAvailable: true }) },
}
export const Pending: Story = {
  args: { flow: flow({ phase: 'pending', attempt, storageAvailable: true }) },
}
export const AccessChanged: Story = {
  args: {
    flow: flow({
      phase: 'succeeded',
      attempt,
      result: { organizationId: 'company', completedAt: '2026-10-15T00:00:00.000Z' },
      access: 'changed',
      storageAvailable: true,
    }),
  },
}
export const CancelReturnsFocus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: messages.organizationCreation.create })
    await userEvent.click(trigger)
    expect(canvas.getByLabelText(messages.organizationCreation.name)).toHaveFocus()
    await userEvent.click(
      canvas.getByRole('button', { name: messages.organizationCreation.cancel })
    )
    expect(trigger).toHaveFocus()
  },
}
export const SubmitExplicitIntent: Story = {
  args: { flow: flow() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: messages.organizationCreation.create })
    )
    await userEvent.type(
      canvas.getByLabelText(messages.organizationCreation.name),
      'Example company'
    )
    await userEvent.click(
      canvas.getByRole('button', { name: messages.organizationCreation.create })
    )
    expect(args.flow.controller.submit).toHaveBeenCalledWith({ name: 'Example company' })
  },
}
