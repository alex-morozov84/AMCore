import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import messages from '../../../../messages/en.json'

import { OrganizationProvisioning } from './organization-provisioning'

const t = messages.console.organizationProvisioning
const root = '/api/console/organization-provisionings'
const binding = 'a'.repeat(64)
const policy = { role: 'ADMIN', mailMode: 'mock', createAllowed: true }
const session = http.get(`${root}/session`, () =>
  HttpResponse.json({ binding, actor: { id: 'operator', email: 'operator@example.test' } })
)
const readiness = http.get(`${root}/policy`, () => HttpResponse.json({ binding, data: policy }))
const meta = {
  title: 'features/console-organization-provisioning/Create and invite',
  component: OrganizationProvisioning,
  parameters: {
    messages: {
      ...messages,
      console: { ...messages.console, audit: { ...messages.console.audit, actions: {} } },
    },
    msw: { handlers: [session, readiness] },
  },
  beforeEach: () => {
    localStorage.removeItem('amcore:organization-provisioning:v1:create')
  },
} satisfies Meta<typeof OrganizationProvisioning>
export default meta
type Story = StoryObj<typeof meta>
export const ThreeSteps: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const start = await canvas.findByRole('button', { name: t.start })
    await waitFor(() => expect(start).toBeEnabled())
    await userEvent.click(start)
    await userEvent.type(canvas.getByLabelText(t.name), 'North shop')
    await userEvent.type(canvas.getByLabelText(t.slug), 'north-shop')
    await userEvent.click(canvas.getByRole('button', { name: t.next }))
    await userEvent.type(await canvas.findByLabelText(t.email), 'anna@example.test')
    await userEvent.click(canvas.getByRole('button', { name: t.next }))
    expect(await canvas.findByText(t.reviewHelp)).toBeVisible()
    expect(canvas.getByText('anna@example.test')).toBeVisible()
    expect(canvas.getByRole('button', { name: t.createAndInvite })).toBeEnabled()
    await userEvent.click(canvas.getByRole('button', { name: t.back }))
    expect(await canvas.findByLabelText(t.email)).toHaveValue('anna@example.test')
  },
}
export const ProductionMockBlocked: Story = {
  parameters: {
    msw: {
      handlers: [
        session,
        http.get(`${root}/policy`, () =>
          HttpResponse.json({ binding, data: { ...policy, createAllowed: false } })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    expect(await within(canvasElement).findByText(t.emailBlocked)).toBeVisible()
  },
}
export const IdentifierConflict: Story = {
  parameters: {
    msw: {
      handlers: [
        session,
        readiness,
        http.post(root, () =>
          HttpResponse.json(
            { errorCode: 'PROVISIONING_SLUG_TAKEN', message: 'Conflict' },
            { status: 409 }
          )
        ),
      ],
    },
  },
  play: async (context) => {
    await ThreeSteps.play!(context)
    const canvas = within(context.canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: t.next }))
    await userEvent.click(await canvas.findByRole('button', { name: t.createAndInvite }))
    expect(await canvas.findByText(messages.errors.PROVISIONING_SLUG_TAKEN)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: t.back }))
    expect(canvas.queryByText(messages.errors.PROVISIONING_SLUG_TAKEN)).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: t.back }))
    await userEvent.click(canvas.getByRole('button', { name: t.cancelForm }))
    await userEvent.click(canvas.getByRole('button', { name: t.start }))
    expect(await canvas.findByLabelText(t.name)).toHaveValue('North shop')
    expect(canvas.queryByText(messages.errors.PROVISIONING_SLUG_TAKEN)).not.toBeInTheDocument()
  },
}
export const MissingRetainedInvitation: Story = {
  args: { orgId: 'north-shop' },
  parameters: {
    msw: {
      handlers: [
        session,
        readiness,
        http.get('/api/console/organizations/north-shop/provisioning', () =>
          HttpResponse.json({
            binding,
            data: {
              organizationId: 'north-shop',
              creationOperationId: '0199eb38-0000-7000-8000-000000000001',
              available: true,
              revision: 2,
              state: 'awaiting',
              invite: null,
              completedAt: null,
              cancelledAt: null,
              access: 'not_established',
              mailOutcome: null,
              policy,
            },
          })
        ),
      ],
    },
  },
  beforeEach: () => {
    localStorage.removeItem('amcore:organization-provisioning:v1:north-shop')
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(t.invitationRemoved)).toBeVisible()
    expect(canvas.getByRole('button', { name: t.chooseRecipient })).toBeEnabled()
    expect(canvas.queryByRole('button', { name: t.start })).not.toBeInTheDocument()
  },
}

export const CreatedResult: Story = {
  parameters: {
    msw: {
      handlers: [
        session,
        readiness,
        http.post(root, async ({ request }) => {
          const input = (await request.json()) as { operationId: string }
          return HttpResponse.json(
            {
              binding,
              data: {
                operationId: input.operationId,
                organizationId: 'north-shop',
                createdAt: '2026-10-17T10:00:00.000Z',
              },
            },
            { status: 201 }
          )
        }),
        http.get('/api/console/organizations/north-shop/provisioning', () =>
          HttpResponse.json({
            binding,
            data: {
              organizationId: 'north-shop',
              creationOperationId: '0199eb38-0000-7000-8000-000000000001',
              available: true,
              revision: 1,
              state: 'awaiting',
              invite: null,
              completedAt: null,
              cancelledAt: null,
              access: 'not_established',
              mailOutcome: 'mock',
              policy,
            },
          })
        ),
      ],
    },
  },
  play: async (context) => {
    await ThreeSteps.play!(context)
    const canvas = within(context.canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: t.next }))
    await userEvent.click(await canvas.findByRole('button', { name: t.createAndInvite }))
    const { screen } = await import('storybook/test')
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(within(dialog).getByRole('heading', { name: t.created })).toBeVisible()
    )
    expect(within(dialog).getByRole('link', { name: t.openOrganization })).toHaveAttribute(
      'href',
      '/en/admin/organizations/north-shop'
    )
    expect(canvas.queryByText(t.pendingHelp)).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: t.dismissReceipt }))
    await userEvent.click(canvas.getByRole('button', { name: t.start }))
    expect(await canvas.findByLabelText(t.name)).toHaveValue('')
  },
}

export const ResetUnsentDraft: Story = {
  play: async (context) => {
    await ThreeSteps.play!(context)
    const canvas = within(context.canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: t.reset }))
    const { screen } = await import('storybook/test')
    let dialog = await screen.findByRole('alertdialog')
    await waitFor(() => expect(within(dialog).getByText(t.resetHelp)).toBeVisible())
    await userEvent.click(within(dialog).getByRole('button', { name: t.back }))
    expect(canvas.getByLabelText(t.email)).toHaveValue('anna@example.test')
    await userEvent.click(canvas.getByRole('button', { name: t.reset }))
    dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: t.resetConfirm }))
    expect(await canvas.findByLabelText(t.name)).toHaveValue('')
    expect(canvas.getByLabelText(t.slug)).toHaveValue('')
  },
}
