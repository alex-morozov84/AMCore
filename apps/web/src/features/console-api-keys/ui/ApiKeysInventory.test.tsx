import { NextIntlClientProvider } from 'next-intl'
import type { AdminApiKey, AdminApiKeyListResponse } from '@amcore/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import en from './api-key-copy.fixture.json'

vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/shared/ui/route-progress-link', () => ({ RouteProgressLink: () => null }))
vi.mock('./ApiKeyMetadata', () => ({
  ApiKeyName: ({ row }: { row: AdminApiKey }) => <span>{row.name}</span>,
  ApiKeyOwner: () => null,
  ApiKeyOrganization: () => null,
  ApiKeyTime: () => null,
}))
vi.mock('@/shared/ui/row-actions-menu', () => ({ RowActionsMenu: () => null }))
vi.mock('./ApiKeyRevokeFlow', () => ({
  ApiKeyRevokeFlow: ({ targets, onClose }: { targets: AdminApiKey[]; onClose: () => void }) => (
    <div data-testid="captured">
      {targets.map((row) => row.name).join(',')}
      <button onClick={onClose}>Cancel capture</button>
    </div>
  ),
}))
import { ApiKeysInventory } from './ApiKeysInventory'

const rows = [
  { id: 'cm123456789012345678901234', name: 'live', status: 'unexpired' },
  { id: 'cm123456789012345678901235', name: 'expired', status: 'expired' },
  { id: 'cm123456789012345678901236', name: 'history', status: 'revoked' },
].map((row) => ({
  ...row,
  scopes: ['read:User'],
  owner: { id: 'u', name: null, email: 'test@example.test' },
  organization: { id: 'o', name: 'Org', slug: 'org' },
  createdAt: '2026-09-28T10:00:00.000Z',
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
})) as AdminApiKey[]
function view(identity = 'one', data = rows) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <ApiKeysInventory
        response={{ data, total: data.length, page: 1, limit: 20 } as AdminApiKeyListResponse}
        identity={identity}
        returnTo="/admin/api-keys"
        headings={null}
        filtered={false}
      />
    </NextIntlClientProvider>
  )
}
describe('page-bound key selection', () => {
  it('selects only eligible visible keys and captures confirmation targets until cancellation', async () => {
    const { rerender } = render(view())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select eligible keys on this page' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke selected (2)' }))
    expect(screen.getByTestId('captured')).toHaveTextContent('live,expired')
    rerender(view('other', rows.slice(2)))
    expect(screen.getByTestId('captured')).toHaveTextContent('live,expired')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel capture' }))
    expect(screen.queryByTestId('captured')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Revoke selected (0)' })).toBeDisabled()
    )
  })
  it('intersects selection on fresh results and clears it on a filter-only identity change', async () => {
    const { rerender } = render(view())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select eligible keys on this page' }))
    rerender(view('one', rows.slice(1)))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Revoke selected (1)' })).toBeEnabled()
    )
    rerender(view('status=expired', rows.slice(1)))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Revoke selected (0)' })).toBeDisabled()
    )
  })
})
