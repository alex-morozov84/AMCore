import { NextIntlClientProvider } from 'next-intl'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { TableHead } from '@/shared/ui/table'

import messages from './api-key-copy.fixture.json'
import { API_KEY_FIXTURES } from './api-key-fixtures'
import { ApiKeysInventory } from './ApiKeysInventory'

const meta = {
  title: 'features/console-api-keys/ApiKeysInventory',
  component: ApiKeysInventory,
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  args: {
    response: { data: API_KEY_FIXTURES, total: 3, page: 1, limit: 20 },
    filtered: false,
    identity: 'all',
    returnTo: '/admin/api-keys',
    headings: [
      'Selection',
      'Key',
      'Owner',
      'Organization',
      'Status',
      'Expires',
      'Last use',
      'Revoked',
      'Created',
      'Actions',
    ].map((label) => <TableHead key={label}>{label}</TableHead>),
  },
} satisfies Meta<typeof ApiKeysInventory>
export default meta
type Story = StoryObj<typeof meta>
export const Populated: Story = {}
export const Empty: Story = { args: { response: { data: [], total: 0, page: 1, limit: 20 } } }
export const FilteredEmpty: Story = {
  args: { filtered: true, response: { data: [], total: 0, page: 1, limit: 20 } },
}
export const Historical: Story = {
  args: { response: { data: [API_KEY_FIXTURES[2]!], total: 1, page: 1, limit: 20 } },
}
export const SelectedConfirmation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      canvas.getByRole('checkbox', { name: 'Select eligible keys on this page' })
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Revoke selected (2)' }))
    expect(await body.findByRole('alertdialog')).toHaveTextContent('Revoke 2 keys?')
    expect(body.getByRole('alertdialog')).toHaveTextContent('Reporting integration')
    expect(body.getByRole('alertdialog')).not.toHaveTextContent('Compromised key')
    await userEvent.click(body.getByRole('button', { name: /^Cancel$/ }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Refresh' })).toHaveFocus())
  },
}
export const NoOp: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/console/api-keys/revoke', () =>
        HttpResponse.json({ requestedCount: 2, affectedCount: 0 })
      )
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      canvas.getByRole('checkbox', { name: 'Select eligible keys on this page' })
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Revoke selected (2)' }))
    await userEvent.click(body.getByRole('button', { name: /^Revoke$/ }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Revoke selected (0)' })).toBeDisabled()
    )
  },
}
