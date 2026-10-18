import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import messages from '../../../../messages/en.json'
import russian from '../../../../messages/ru.json'

import { OrganizationProvisioning } from './organization-provisioning'

const invitationLanguage =
  SUPPORTED_LOCALES.find((locale) => String(locale) === 'ru') ?? DEFAULT_LOCALE
const t = messages.console.organizationProvisioning
const binding = 'a'.repeat(64)
const root = '/api/console/organization-provisionings'
const orgId = 'north-shop'
const progressPath = `/api/console/organizations/${orgId}/provisioning`
const policy = { role: 'ADMIN', mailMode: 'mock', createAllowed: true }
const data = {
  organizationId: orgId,
  creationOperationId: '0199eb38-0000-7000-8000-000000000001',
  available: true,
  revision: 1,
  state: 'awaiting',
  invite: {
    id: 'invitation',
    generation: 1,
    email: 'anna@example.test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    status: 'pending',
  },
  completedAt: null,
  cancelledAt: null,
  access: 'not_established',
  mailOutcome: 'mock',
  policy,
}
const common = [
  http.get(`${root}/session`, () =>
    HttpResponse.json({ binding, actor: { id: 'operator', email: 'operator@example.test' } })
  ),
  http.get(`${root}/policy`, () => HttpResponse.json({ binding, data: policy })),
]
const meta = {
  title: 'features/console-organization-provisioning/Invitation management',
  component: OrganizationProvisioning,
  args: { orgId },
  beforeEach: () => {
    localStorage.removeItem(`amcore:organization-provisioning:v1:${orgId}`)
    localStorage.removeItem('amcore:organization-provisioning:v1:create')
  },
  parameters: {
    messages: { ...messages, console: { ...messages.console, audit: {} } },
    msw: {
      handlers: [...common, http.get(progressPath, () => HttpResponse.json({ binding, data }))],
    },
  },
} satisfies Meta<typeof OrganizationProvisioning>
export default meta
type Story = StoryObj<typeof meta>

export const AwaitingAdministrator: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(t.pendingHelp)).toBeVisible()
    expect(canvas.getByText(t.mail.mock)).toBeVisible()
    expect(canvas.getByText(t.stopHelp)).toBeVisible()
    expect(canvas.queryByRole('link')).not.toBeInTheDocument()
    const check = canvas.getByRole('button', { name: t.checkStatus })
    expect(check).toHaveAttribute('data-variant', 'default')
    await waitFor(() => expect(check).toBeEnabled())
    await userEvent.click(check)
    expect(
      await canvas.findByText(messages.console.organizationAdministration.refreshPending, {
        exact: false,
      })
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: t.endWithoutAdmin }))
    const dialog = within(await within(document.body).findByRole('alertdialog'))
    await waitFor(() => expect(dialog.getByText(t.cancelWarning)).toBeVisible())
    expect(dialog.getByRole('button', { name: t.confirmCancel })).toHaveAttribute(
      'data-variant',
      'destructive'
    )
    await userEvent.click(dialog.getByRole('button', { name: t.backToInvitation }))
    await waitFor(() =>
      expect(within(document.body).queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(canvas.getByText(t.pendingHelp)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: t.reissue }))
    const resend = within(await within(document.body).findByRole('alertdialog'))
    await waitFor(() => expect(resend.getByText(t.reissueWarning)).toBeVisible())
    expect(resend.getByText(data.invite.email)).toBeVisible()
    await userEvent.click(resend.getByRole('button', { name: t.back }))
  },
}
export const Cancelled: Story = {
  parameters: {
    msw: {
      handlers: [
        ...common,
        http.get(progressPath, () =>
          HttpResponse.json({
            binding,
            data: {
              ...data,
              state: 'cancelled',
              invite: null,
              cancelledAt: '2026-10-17T10:00:00.000Z',
            },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvasElement).toBeEmptyDOMElement())
    expect(canvas.queryByRole('button')).not.toBeInTheDocument()
  },
}
export const CancelledRussian: Story = {
  ...Cancelled,
  parameters: {
    ...Cancelled.parameters,
    messages: { ...russian, console: { ...russian.console, audit: {} } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvasElement).toBeEmptyDOMElement())
    expect(canvas.queryByRole('button')).not.toBeInTheDocument()
  },
}
export const SavedResultDoesNotReopenReceipt: Story = {
  args: { orgId: undefined },
  beforeEach: () => {
    localStorage.setItem(
      'amcore:organization-provisioning:v1:create',
      JSON.stringify({
        version: 1,
        actorId: 'operator',
        binding,
        at: Date.now(),
        open: false,
        step: 1,
        draft: { name: '', slug: '', firstAdminEmail: '', inviteLocale: DEFAULT_LOCALE },
        organizationId: orgId,
      })
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: t.start })
    expect(canvas.queryByRole('heading', { name: t.created })).not.toBeInTheDocument()
    expect(canvas.queryByRole('link', { name: t.openOrganization })).not.toBeInTheDocument()
    expect(canvas.queryByText(t.pendingHelp)).not.toBeInTheDocument()
    expect(canvas.queryByText(t.cancelled)).not.toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: t.checkStatus })).not.toBeInTheDocument()
    const start = canvas.getByRole('button', { name: t.start })
    await waitFor(() => expect(start).toBeEnabled())
    await userEvent.click(start)
    expect(await canvas.findByLabelText(t.name)).toHaveValue('')
    expect(canvas.queryByRole('heading', { name: t.created })).not.toBeInTheDocument()
  },
}

export const FrozenCreationKeepsPriority: Story = {
  args: { orgId: undefined },
  beforeEach: () => {
    localStorage.setItem(
      'amcore:organization-provisioning:v1:create',
      JSON.stringify({
        version: 1,
        actorId: 'operator',
        binding,
        at: Date.now(),
        open: true,
        step: 3,
        draft: {
          name: 'North shop',
          slug: 'north-shop',
          firstAdminEmail: 'anna@example.test',
          inviteLocale: DEFAULT_LOCALE,
        },
        pending: {
          kind: 'create',
          input: {
            operationId: data.creationOperationId,
            name: 'North shop',
            slug: 'north-shop',
            firstAdminEmail: 'anna@example.test',
            inviteLocale: DEFAULT_LOCALE,
          },
        },
      })
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(t.unknown)).toBeVisible()
    expect(canvas.getByRole('button', { name: t.checkResult })).toBeVisible()
    expect(canvas.getByRole('button', { name: t.retrySame })).toBeVisible()
    expect(canvas.queryByRole('button', { name: t.start })).not.toBeInTheDocument()
    expect(canvas.queryByRole('heading', { name: t.created })).not.toBeInTheDocument()
    expect(canvas.queryByLabelText(t.name)).not.toBeInTheDocument()
  },
}

const refusedReplacement = [
  ...common,
  http.get(progressPath, () => HttpResponse.json({ binding, data })),
  http.post(`${progressPath}/replace-recipient`, () =>
    HttpResponse.json(
      {
        errorCode: 'PROVISIONING_STATE_CHANGED',
        message: 'Controlled refusal',
      },
      { status: 409 }
    )
  ),
]
function replacementRecovery(labels: typeof t, canvasElement: HTMLElement) {
  return (async () => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: labels.replace }))
    let dialog = within(await within(document.body).findByRole('dialog'))
    await userEvent.type(dialog.getByLabelText(labels.email), 'recover@example.test')
    await userEvent.click(dialog.getByRole('combobox'))
    await userEvent.click(
      await within(document.body).findByRole('option', {
        name: labels[String(invitationLanguage) === 'ru' ? 'russian' : 'english'],
      })
    )
    await userEvent.click(dialog.getByRole('button', { name: labels.next }))
    const review = within(await within(document.body).findByRole('alertdialog'))
    await userEvent.click(review.getByRole('button', { name: labels.back }))
    dialog = within(await within(document.body).findByRole('dialog'))
    expect(dialog.getByLabelText(labels.email)).toHaveValue('recover@example.test')
    expect(dialog.getByRole('combobox')).toHaveTextContent(
      labels[String(invitationLanguage) === 'ru' ? 'russian' : 'english']
    )
    await userEvent.click(dialog.getByRole('button', { name: labels.next }))
    await userEvent.click(
      within(await within(document.body).findByRole('alertdialog')).getByRole('button', {
        name: labels.confirmReplace,
      })
    )
    const form = await within(document.body).findByRole('dialog')
    await waitFor(() => expect(within(form).getByRole('alert')).toBeVisible())
    expect(within(form).getByLabelText(labels.email)).toHaveValue('recover@example.test')
    expect(within(form).getByRole('combobox')).toHaveTextContent(
      labels[String(invitationLanguage) === 'ru' ? 'russian' : 'english']
    )
    expect(localStorage.getItem(`amcore:organization-provisioning:v1:${orgId}`)).not.toContain(
      '"pending":'
    )
    await userEvent.click(within(form).getByRole('button', { name: labels.cancelForm }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument())
  })()
}
export const ReplacementRecovery: Story = {
  parameters: { msw: { handlers: refusedReplacement } },
  play: ({ canvasElement }) => replacementRecovery(t, canvasElement),
}
export const ReplacementRecoveryRu: Story = {
  ...ReplacementRecovery,
  parameters: {
    messages: { ...russian, console: { ...russian.console, audit: {} } },
    msw: { handlers: refusedReplacement },
  },
  play: ({ canvasElement }) =>
    replacementRecovery(russian.console.organizationProvisioning, canvasElement),
}
