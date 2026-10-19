import { NextIntlClientProvider } from 'next-intl'
import { type ApiKeyListItemResponse, DEFAULT_LOCALE } from '@amcore/shared'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type * as ApiKeyEntity from '@/entities/api-key'
import { OwnApiKeyController } from '@/entities/api-key'
import { ApiRequestError } from '@/shared/api/http-client'

import { OwnApiKeys } from './own-api-keys'

vi.mock('client-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({ Link: 'a', useRouter: () => ({}) }))
const rows = vi.hoisted(() => [] as ApiKeyListItemResponse[])
vi.mock('@/entities/api-key', async (original) => ({
  ...(await original<typeof ApiKeyEntity>()),
  OwnKeyOrganizationPicker: () => null,
  useOwnApiKeys: () => ({
    data: { data: rows, total: rows.length, page: 1, limit: 20 },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}))
const messages = (await import('../../../../messages/' + DEFAULT_LOCALE + '.json')).default
const t = messages.ownApiKeys
beforeEach(() => {
  rows.length = 0
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})
function fixture() {
  const client = {
    verify: vi.fn().mockResolvedValue({ verified: true as const }),
    create: vi.fn(),
    list: vi.fn(),
    revoke: vi.fn().mockResolvedValue({ revoked: true as const }),
  }
  const controller = new OwnApiKeyController({ binding: 'a'.repeat(64), actorId: 'actor' }, client)
  render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages} timeZone="UTC">
      <OwnApiKeys
        controller={controller}
        disabled={false}
        query={{ page: 1, limit: 20, status: 'all' }}
        invalidQuery={false}
        onQueryChange={() => undefined}
      />
    </NextIntlClientProvider>
  )
  return { controller, client }
}
async function unknown(f: ReturnType<typeof fixture>, id: string) {
  f.client.revoke.mockRejectedValueOnce(new Error('lost reply'))
  await act(async () => {
    await expect(f.controller.revoke(id)).rejects.toThrow('lost reply')
  })
}
it.each([false, true])(
  'retry binds missing key B, independent of a previous row (%s)',
  async (previous) => {
    if (previous)
      rows.push({
        id: 'key-a',
        name: 'Row A',
        organizationId: 'org-a',
        organizationName: 'Acme',
        scopes: [],
        createdAt: '2026-10-19T00:00:00Z',
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        revocationReason: null,
        status: 'unexpired',
      })
    const f = fixture()
    if (previous) {
      fireEvent.click(screen.getByRole('button', { name: t.rowActions.replace('{name}', 'Row A') }))
      fireEvent.click(await screen.findByRole('menuitem', { name: t.revoke }))
      fireEvent.click(screen.getByRole('button', { name: t.cancel }))
    }
    await unknown(f, 'key-b')
    fireEvent.click(screen.getByRole('button', { name: t.revokeAgain }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      t.revokeIdDescription.replace('{id}', 'key-b')
    )
    fireEvent.click(screen.getByRole('button', { name: t.revoke }))
    await waitFor(() => expect(f.client.revoke).toHaveBeenCalledTimes(2))
    expect(f.client.revoke.mock.calls[1]?.[1]).toBe('key-b')
  }
)
it('keeps the confirmation ID frozen when another consumer updates the receipt', async () => {
  const f = fixture()
  await unknown(f, 'key-b')
  fireEvent.click(screen.getByRole('button', { name: t.revokeAgain }))
  await unknown(f, 'key-c')
  expect(screen.getByRole('alertdialog')).toHaveTextContent('key-b')
  fireEvent.click(screen.getByRole('button', { name: t.revoke }))
  await waitFor(() => expect(f.client.revoke).toHaveBeenCalledTimes(3))
  expect(f.client.revoke.mock.calls[2]?.[1]).toBe('key-b')
})
it('distinguishes an ordinary DELETE refusal from a session probe failure', async () => {
  const f = fixture()
  f.client.revoke.mockRejectedValueOnce(new ApiRequestError(403, undefined))
  await act(async () => {
    await expect(f.controller.revoke('key-b')).rejects.toBeInstanceOf(ApiRequestError)
  })
  expect(screen.getByText(t.revokeRefused)).toBeVisible()
  expect(screen.queryByText(t.sessionCheckFailed)).not.toBeInTheDocument()
})
