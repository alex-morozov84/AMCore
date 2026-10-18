import { DEFAULT_LOCALE } from '@amcore/shared'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import messages from '../../../../messages/en.json'
import russian from '../../../../messages/ru.json'

import { OrganizationSetup } from './organization-setup'

const t = messages.console.organizationSetup
const binding = 'a'.repeat(64)
const root = '/api/console/organization-establishment'
const ids = {
  organizationId: 'company',
  userId: 'recipient',
  memberId: 'member',
  adminRoleId: 'admin-role',
  adminGrantId: 'grant',
}
const selected = {
  userId: 'recipient',
  email: 'recipient@example.test',
  emailVerified: true,
  state: 'eligible-empty',
}
const session = http.get(`${root}/session`, () =>
  HttpResponse.json({ binding, actor: { id: 'operator', email: 'operator@example.test' } })
)
const status = (state = 'eligible-empty') =>
  http.get(`${root}/status`, () =>
    HttpResponse.json({
      binding,
      data: {
        state,
        ...(state.startsWith('completed') ? { ids, completedAt: '2026-10-16T10:00:00.000Z' } : {}),
      },
    })
  )
const account = (verified: boolean) =>
  http.get(`${root}/accounts/recipient/status`, () =>
    HttpResponse.json({ binding, data: { ...selected, emailVerified: verified } })
  )
const prepare = (verified: boolean) =>
  http.post(`${root}/accounts/prepare`, () =>
    HttpResponse.json({
      binding,
      data: {
        status: verified ? 'existing' : 'created',
        userId: 'recipient',
        emailVerified: verified,
        nextAction: verified ? 'sign-in' : 'verify-email',
      },
    })
  )
const meta = {
  title: 'features/console-organization-setup/First organization',
  component: OrganizationSetup,
  parameters: { msw: { handlers: [session, status()] } },
  beforeEach: () => {
    sessionStorage.removeItem('amcore:initial-organization-setup:v1')
  },
} satisfies Meta<typeof OrganizationSetup>
export default meta
type Story = StoryObj<typeof meta>
export const Eligible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: t.trustedStart }))
    expect(await canvas.findByRole('heading', { name: t.headings.administrator })).toBeVisible()
    expect(canvas.getByRole('button', { name: t.continue })).toBeVisible()
    expect(canvas.getByLabelText(t.email)).toBeVisible()
    expect(canvas.getByRole('combobox')).toHaveTextContent(t.languages[DEFAULT_LOCALE])
  },
}
export const NotReady: Story = {
  parameters: {
    msw: {
      handlers: [
        session,
        http.get(`${root}/status`, () =>
          HttpResponse.json({
            binding,
            data: { state: 'not-ready', reason: 'templates-unavailable' },
          })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(t.states['not-ready'])).toBeVisible()
    expect(canvas.queryByRole('button', { name: t.continue })).not.toBeInTheDocument()
  },
}
export const OrganizationAlreadyExists: Story = {
  parameters: { msw: { handlers: [session, status('existing-org-without-receipt')] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.queryByRole('heading', { name: t.title })).not.toBeInTheDocument()
    )
    expect(canvas.queryByRole('button', { name: t.refresh })).not.toBeInTheDocument()
    expect(canvas.queryByText(t.deploymentHelp)).not.toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: t.continue })).not.toBeInTheDocument()
  },
}
export const RecipientNeedsVerification: Story = {
  parameters: { msw: { handlers: [session, status(), prepare(false), account(false)] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: t.trustedStart }))
    await userEvent.type(await canvas.findByLabelText(t.email), selected.email)
    await userEvent.click(canvas.getByRole('button', { name: t.continue }))
    expect(await canvas.findByText(t.unverified)).toBeVisible()
    expect(canvas.getByText(t.mailHelp)).toBeVisible()
    expect(canvas.getByRole('button', { name: t.checkEmail })).toBeVisible()
    expect(canvas.queryByRole('button', { name: t.continue })).not.toBeInTheDocument()
    expect(canvas.queryByLabelText(t.name)).not.toBeInTheDocument()
  },
}
export const VerifiedAccountAndBack: Story = {
  parameters: { msw: { handlers: [session, status(), prepare(true), account(true)] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: t.trustedStart }))
    await userEvent.type(await canvas.findByLabelText(t.email), selected.email)
    await userEvent.click(canvas.getByRole('button', { name: t.continue }))
    expect(await canvas.findByRole('heading', { name: t.headings.organization })).toBeVisible()
    expect(canvas.getByText(t.verified)).toBeVisible()
    await userEvent.type(canvas.getByLabelText(t.name), 'Anna shop')
    await userEvent.type(canvas.getByLabelText(t.slug), 'anna-shop')
    await userEvent.click(canvas.getByRole('button', { name: t.continue }))
    expect(await canvas.findByRole('heading', { name: t.headings.review })).toHaveFocus()
    expect(canvas.getByText(selected.email, { exact: true })).toBeVisible()
    expect(canvas.getByRole('button', { name: t.finish })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: t.back }))
    expect(await canvas.findByLabelText(t.name)).toHaveValue('Anna shop')
    expect(canvas.getByLabelText(t.slug)).toHaveValue('anna-shop')
    await userEvent.click(canvas.getByRole('button', { name: t.back }))
    expect(await canvas.findByRole('heading', { name: t.headings.administrator })).toHaveFocus()
    await userEvent.click(canvas.getByRole('button', { name: t.continue }))
    expect(await canvas.findByLabelText(t.name)).toHaveValue('Anna shop')
  },
}
export const Completed: Story = {
  parameters: { msw: { handlers: [session, status('completed-intact'), account(true)] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.queryByText(t.loading)).not.toBeInTheDocument())
    expect(canvas.queryByRole('heading', { name: t.title })).not.toBeInTheDocument()
  },
}
export const AccessChanged: Story = {
  parameters: { msw: { handlers: [session, status('completed-changed'), account(true)] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.queryByText(t.loading)).not.toBeInTheDocument())
    expect(canvas.queryByRole('heading', { name: t.title })).not.toBeInTheDocument()
  },
}
export const CompletedRussian: Story = {
  parameters: {
    messages: russian,
    msw: { handlers: [session, status('completed-intact'), account(true)] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.queryByText(russian.console.organizationSetup.loading)).not.toBeInTheDocument()
    )
    expect(
      canvas.queryByRole('heading', { name: russian.console.organizationSetup.title })
    ).not.toBeInTheDocument()
  },
}

export const RecipientUnavailable: Story = {
  beforeEach: () => {
    sessionStorage.setItem(
      'amcore:initial-organization-setup:v1',
      JSON.stringify({
        version: 1,
        binding,
        actorId: 'operator',
        selected,
        draft: { email: selected.email, name: 'Anna shop', slug: 'anna-shop' },
        step: 'review',
      })
    )
  },
  parameters: {
    msw: {
      handlers: [
        session,
        status(),
        http.get(`${root}/accounts/recipient/status`, () =>
          HttpResponse.json({ errorCode: 'SETUP_ACCOUNT_UNAVAILABLE' }, { status: 404 })
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(t.recipientUnavailable)).toBeVisible()
    expect(canvas.queryByText(t.loading)).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: t.changeRecipient }))
    expect(await canvas.findByLabelText(t.email)).toHaveValue(selected.email)
    expect(canvas.queryByText(t.recipientUnavailable)).not.toBeInTheDocument()
  },
}
export const RecipientUnavailableRussian: Story = {
  ...RecipientUnavailable,
  parameters: { ...RecipientUnavailable.parameters, messages: russian },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const ru = russian.console.organizationSetup
    expect(await canvas.findByText(ru.recipientUnavailable)).toBeVisible()
    expect(canvas.queryByText(ru.loading)).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: ru.changeRecipient }))
    expect(await canvas.findByLabelText(ru.email)).toHaveValue(selected.email)
  },
}

export const UnknownSetupBeforeHide: Story = {
  beforeEach: () => {
    sessionStorage.setItem(
      'amcore:initial-organization-setup:v1',
      JSON.stringify({
        version: 1,
        binding,
        actorId: 'operator',
        selected,
        draft: { email: selected.email, name: 'Anna shop', slug: 'anna-shop' },
        step: 'review',
        pending: {
          kind: 'bootstrap',
          input: { name: 'Anna shop', slug: 'anna-shop', adminUserId: selected.userId },
        },
      })
    )
  },
  parameters: {
    msw: { handlers: [session, status('existing-org-without-receipt'), account(true)] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(t.unknown)).toBeVisible()
    expect(canvas.getByRole('button', { name: t.checkResult })).toBeVisible()
    expect(canvas.getByRole('button', { name: t.repeat })).toBeVisible()
    expect(canvas.queryByText(t.existingOrganizationHelp)).not.toBeInTheDocument()
  },
}
