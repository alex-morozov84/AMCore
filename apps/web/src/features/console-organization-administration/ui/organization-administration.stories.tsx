import type { AdministratorSummary } from '@amcore/shared'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import messages from '../../../../messages/en.json'
import russianMessages from '../../../../messages/ru.json'

import { AdministratorDialog } from './administrator-dialog'
import { OrganizationAdministration } from './organization-administration'
import { OrganizationAttention } from './organization-attention'

const invitationLanguage =
  SUPPORTED_LOCALES.find((locale) => String(locale) === 'ru') ?? DEFAULT_LOCALE
const t = messages.console.organizationAdministration
const binding = 'a'.repeat(64)
const orgId = '11111111-1111-4111-8111-111111111111'
const root = `/api/console/organizations/${orgId}/administration`
const session = http.get('/api/console/organization-provisionings/session', () =>
  HttpResponse.json({ binding, actor: { id: 'operator', email: 'operator@example.test' } })
)
const summary: AdministratorSummary = {
  organizationId: orgId,
  name: 'North shop',
  aclVersion: 2,
  checkedAt: '2026-10-17T12:00:00.000Z',
  policy: { role: 'ADMIN', mailMode: 'mock', createAllowed: true },
  administrators: {
    total: 2,
    data: [
      { userId: 'anna', memberId: 'member-anna', name: 'Anna', email: 'anna@example.test' },
      { userId: 'ivan', memberId: 'member-ivan', name: 'Ivan', email: 'ivan@example.test' },
    ],
  },
  invitations: {
    total: 1,
    data: [
      {
        id: '0199c011-0000-7000-8000-000000000001',
        organizationId: orgId,
        revision: 1,
        state: 'awaiting',
        invite: {
          id: 'invite-a',
          generation: 1,
          email: 'next@example.test',
          expiresAt: '2026-10-24T12:00:00.000Z',
          status: 'pending',
        },
        completedAt: null,
        cancelledAt: null,
        mailOutcome: 'mock',
      },
    ],
  },
  initial: null,
}
const meta = {
  title: 'features/console-organization-administration/Operator journey',
  component: OrganizationAdministration,
  args: {
    orgId,
    members: [
      {
        memberId: 'member-oleg',
        user: { id: 'oleg', name: 'Oleg', email: 'oleg@example.test' },
        roles: [],
        joinedAt: '2026-10-17T12:00:00.000Z',
      },
    ],
  },
  parameters: {
    messages: {
      ...messages,
      console: { ...messages.console, audit: { ...messages.console.audit, actions: {} } },
    },
    msw: {
      handlers: [session, http.get(root, () => HttpResponse.json({ binding, data: summary }))],
    },
  },
  beforeEach: () => {
    localStorage.removeItem(`amcore:organization-administration:v1:${orgId}`)
  },
} satisfies Meta<typeof OrganizationAdministration>
export default meta
type Story = StoryObj<typeof meta>
export const MultipleAdministrators: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('Anna')).toBeVisible()
    expect(canvas.getByText('Ivan')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: t.promote }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
    expect(within(dialog).queryByText(t.initialAssignmentWarning)).not.toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByText(/oleg@example.test/)).toBeVisible())
    await userEvent.type(within(dialog).getByLabelText(t.reason), 'Support TEST-49')
    await userEvent.click(within(dialog).getByRole('button', { name: t.reviewAction }))
    expect(within(dialog).getByRole('button', { name: t.promote })).toBeEnabled()
    await userEvent.click(within(dialog).getByRole('button', { name: t.close }))
  },
}
export const RecipientModal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: t.replace }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
    await userEvent.type(within(dialog).getByLabelText(t.email), 'replacement@example.test')
    await userEvent.type(within(dialog).getByLabelText(t.reason), 'TEST-49 replacement')
    await userEvent.click(within(dialog).getByRole('button', { name: t.continue }))
    expect(within(dialog).getByText('replacement@example.test')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: t.confirmInvite })).toBeEnabled()
    await userEvent.click(within(dialog).getByRole('button', { name: t.back }))
    expect(await within(dialog).findByLabelText(t.email)).toHaveValue('replacement@example.test')
    expect(within(dialog).getByLabelText(t.reason)).toHaveValue('TEST-49 replacement')
    await userEvent.click(within(dialog).getByRole('button', { name: t.close }))
    expect(canvas.getByText('next@example.test')).toBeVisible()
  },
}
export const CancelExplainsConsequence: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = await canvas.findByRole('button', { name: t.cancel })
    expect(trigger).toHaveAttribute('data-variant', 'destructive')
    await userEvent.click(trigger)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
    await waitFor(() => expect(within(dialog).getByText(t.cancelHelp)).toBeVisible())
    await userEvent.type(within(dialog).getByLabelText(t.reason), 'TEST-49 cancellation')
    await userEvent.click(within(dialog).getByRole('button', { name: t.reviewAction }))
    expect(within(dialog).getByRole('button', { name: t.confirmCancel })).toHaveAttribute(
      'data-variant',
      'destructive'
    )
    await userEvent.click(within(dialog).getByRole('button', { name: t.close }))
  },
}
export const AllUnfinishedOrganizations: Story = {
  render: () => <OrganizationAttention />,
  parameters: {
    msw: {
      handlers: [
        session,
        http.get('/api/console/organizations/attention', () =>
          HttpResponse.json({
            binding,
            data: {
              total: 2,
              organizationTotal: 3,
              page: 1,
              limit: 20,
              data: [
                {
                  organizationId: orgId,
                  name: 'North shop',
                  slug: 'north-shop',
                  adminCount: 0,
                  pendingAdminInvitationCount: 1,
                  reasons: ['pending', 'no_administrator'],
                },
                {
                  organizationId: '22222222-2222-4222-8222-222222222222',
                  name: 'South shop',
                  slug: 'south-shop',
                  adminCount: 1,
                  pendingAdminInvitationCount: 1,
                  reasons: ['expired'],
                },
              ],
            },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByRole('heading', { name: 'North shop' })).toBeVisible()
    expect(canvas.getByRole('heading', { name: 'South shop' })).toBeVisible()
    expect(canvas.getAllByRole('link', { name: t.open })).toHaveLength(2)
  },
}

export const ExpiredRequestRecovery: Story = {
  beforeEach: () => {
    localStorage.setItem(
      `amcore:organization-administration:v1:${orgId}`,
      JSON.stringify({
        actorId: 'operator',
        at: Date.now() - 2 * 86400000,
        operationId: '01900000-0000-7000-8000-000000000000',
      })
    )
  },
  parameters: {
    msw: {
      handlers: [
        session,
        http.get(root, () => HttpResponse.json({ binding, data: summary })),
        http.get(`${root}/operations/:id`, () =>
          HttpResponse.json({ binding, data: { state: 'unknown', expiredUnrecorded: true } })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(t.unknown)).toBeVisible()
    expect(await canvas.findByRole('button', { name: t.invite })).toBeDisabled()
    expect(canvas.queryByRole('button', { name: t.acknowledgeExpired })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: t.checkResult }))
    expect(await canvas.findByText(t.expiredUnrecorded)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: t.acknowledgeExpired }))
    await waitFor(() => expect(canvas.getByRole('button', { name: t.invite })).toBeEnabled())
    expect(canvas.queryByText(t.unknown)).not.toBeInTheDocument()
  },
}

export const EmptyAdministration: Story = {
  args: { members: [] },
  parameters: {
    msw: {
      handlers: [
        session,
        http.get(root, () =>
          HttpResponse.json({
            binding,
            data: {
              ...summary,
              administrators: { total: 0, data: [] },
              invitations: { total: 0, data: [] },
            },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(t.noAdmins)).toBeVisible()
    await waitFor(() => expect(canvas.getByRole('button', { name: t.invite })).toBeEnabled())
    expect(canvas.queryByRole('heading', { name: t.promote })).not.toBeInTheDocument()
    expect(canvas.queryByRole('heading', { name: t.invitationsTitle })).not.toBeInTheDocument()
  },
}

export const InitialAssignmentWarns: Story = {
  render: () => (
    <AdministratorDialog
      action={{
        kind: 'assign',
        userId: 'oleg',
        memberId: 'member-oleg',
        email: 'oleg@example.test',
        roles: ['MEMBER'],
      }}
      summary={{
        ...summary,
        initial: {
          organizationId: orgId,
          creationOperationId: '0199c011-0000-7000-8000-000000000099',
          available: true,
          revision: 1,
          state: 'awaiting',
          invite: null,
          completedAt: null,
          cancelledAt: null,
          access: 'not_established',
          mailOutcome: 'mock',
          policy: summary.policy,
        },
      }}
      blocked={false}
      onSubmit={() => {
        throw new Error('This inspection must not submit')
      }}
      onClose={() => {}}
    />
  ),
  play: async () => {
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
    expect(within(dialog).getByText(t.initialAssignmentWarning)).toBeVisible()
    await userEvent.type(within(dialog).getByLabelText(t.reason), 'Support TEST-49')
    await userEvent.click(within(dialog).getByRole('button', { name: t.reviewAction }))
    expect(within(dialog).getByText(t.initialAssignmentWarning)).toBeVisible()
    expect(within(dialog).getByRole('button', { name: t.promote })).toBeEnabled()
    await userEvent.click(within(dialog).getByRole('button', { name: t.back }))
    expect(await within(dialog).findByLabelText(t.reason)).toHaveValue('Support TEST-49')
  },
}

export const InitialAssignmentWarnsRu: Story = {
  ...InitialAssignmentWarns,
  parameters: { messages: russianMessages },
  play: async () => {
    const labels = russianMessages.console.organizationAdministration
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toBeVisible())
    expect(within(dialog).getByText(labels.initialAssignmentWarning)).toBeVisible()
    await userEvent.type(within(dialog).getByLabelText(labels.reason), 'Support TEST-49')
    await userEvent.click(within(dialog).getByRole('button', { name: labels.reviewAction }))
    expect(within(dialog).getByText(labels.initialAssignmentWarning)).toBeVisible()
    expect(within(dialog).getByRole('button', { name: labels.promote })).toBeEnabled()
  },
}

function refusalHandlers(code: 'ADMIN_INVITATION_ALREADY_PENDING' | 'RATE_LIMIT_EXCEEDED') {
  const respond: HttpResponseResolver = async ({ request }) => {
    const input = (await request.json()) as { supersedesInvite?: unknown }
    if (input.supersedesInvite)
      return HttpResponse.json(
        { errorCode: 'ADMIN_OPERATION_UNCONFIRMED', message: 'Controlled unknown' },
        { status: 503 }
      )
    return HttpResponse.json(
      {
        errorCode: code,
        message: 'Controlled refusal',
        ...(code === 'ADMIN_INVITATION_ALREADY_PENDING'
          ? { details: { supersedesInvite: { id: 'ordinary-invite', generation: 1 } } }
          : {}),
      },
      {
        status: code === 'RATE_LIMIT_EXCEEDED' ? 429 : 409,
        headers: code === 'RATE_LIMIT_EXCEEDED' ? { 'Retry-After': '3600' } : {},
      }
    )
  }
  return [
    session,
    http.get(root, () => HttpResponse.json({ binding, data: summary })),
    http.post(`${root}/invitations`, respond),
    http.post(`${root}/invitations/${summary.invitations.data[0]!.id}/replace-recipient`, respond),
  ]
}
async function formRefusal(labels: typeof t, canvasElement: HTMLElement, create: boolean) {
  const canvas = within(canvasElement)
  await userEvent.click(
    await canvas.findByRole('button', { name: create ? labels.invite : labels.replace })
  )
  let dialog = await screen.findByRole('dialog')
  await userEvent.type(within(dialog).getByLabelText(labels.email), 'retained@example.test')
  await userEvent.type(within(dialog).getByLabelText(labels.reason), 'Support TEST-49 retained')
  await userEvent.click(within(dialog).getByRole('combobox'))
  await userEvent.click(
    await screen.findByRole('option', {
      name: labels[String(invitationLanguage) === 'ru' ? 'russian' : 'english'],
    })
  )
  await userEvent.click(within(dialog).getByRole('button', { name: labels.continue }))
  await userEvent.click(within(dialog).getByRole('button', { name: labels.confirmInvite }))
  dialog = await screen.findByRole('dialog')
  await waitFor(() =>
    expect(within(dialog).getByLabelText(labels.email)).toHaveValue('retained@example.test')
  )
  expect(within(dialog).getByLabelText(labels.reason)).toHaveValue('Support TEST-49 retained')
  expect(within(dialog).getByRole('combobox')).toHaveTextContent(
    labels[String(invitationLanguage) === 'ru' ? 'russian' : 'english']
  )
  await waitFor(() => expect(within(dialog).getByRole('alert')).toBeVisible())
  if (create) {
    await userEvent.click(within(dialog).getByRole('button', { name: labels.supersede }))
    const confirmation = within(await screen.findByRole('alertdialog'))
    await userEvent.click(confirmation.getByRole('button', { name: labels.supersede }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await canvas.findByText(labels.unknown)).toBeVisible()
    const raw = localStorage.getItem(`amcore:organization-administration:v1:${orgId}`)!
    expect(raw).toContain('retained@example.test')
    expect(raw).toContain('Support TEST-49 retained')
    expect(raw).toContain('ordinary-invite')
    expect(canvas.getByRole('button', { name: labels.invite })).toBeDisabled()
  } else {
    await userEvent.click(within(dialog).getByRole('button', { name: labels.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  }
}
export const CreateRefusalRecovery: Story = {
  parameters: { msw: { handlers: refusalHandlers('ADMIN_INVITATION_ALREADY_PENDING') } },
  play: ({ canvasElement }) => formRefusal(t, canvasElement, true),
}
export const CreateRefusalRecoveryRu: Story = {
  parameters: {
    messages: {
      ...russianMessages,
      console: {
        ...russianMessages.console,
        audit: { ...russianMessages.console.audit, actions: {} },
      },
    },
    msw: { handlers: refusalHandlers('ADMIN_INVITATION_ALREADY_PENDING') },
  },
  play: ({ canvasElement }) =>
    formRefusal(russianMessages.console.organizationAdministration, canvasElement, true),
}
export const ReplaceRefusalRecovery: Story = {
  parameters: { msw: { handlers: refusalHandlers('RATE_LIMIT_EXCEEDED') } },
  play: ({ canvasElement }) => formRefusal(t, canvasElement, false),
}
export const ReplaceRefusalRecoveryRu: Story = {
  parameters: {
    messages: {
      ...russianMessages,
      console: {
        ...russianMessages.console,
        audit: { ...russianMessages.console.audit, actions: {} },
      },
    },
    msw: { handlers: refusalHandlers('RATE_LIMIT_EXCEEDED') },
  },
  play: ({ canvasElement }) =>
    formRefusal(russianMessages.console.organizationAdministration, canvasElement, false),
}
