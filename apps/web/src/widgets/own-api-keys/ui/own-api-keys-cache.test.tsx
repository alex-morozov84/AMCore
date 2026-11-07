import { type ReactNode, useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import type { ApiKeyListItemResponse, ApiKeyListResponse, ApiKeyQuery } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type * as KeyEntity from '@/entities/api-key'
import { OwnApiKeyController, useOwnApiKeys } from '@/entities/api-key'
import { OwnApiKeyRevoke } from '@/features/own-api-key-revoke'
import { toast } from '@/shared/ui/toast'

import messages from '../../../../messages/en.json'

import { OwnApiKeys } from './own-api-keys'
import { OwnApiKeysHost } from './own-api-keys-host'

vi.mock('client-only', () => ({}))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/i18n/navigation', () => ({ Link: 'a', usePathname: () => '/settings/api-keys' }))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/entities/organization-context', () => ({
  useOrganizationContext: () => ({ state: { status: 'ready' }, refresh: vi.fn() }),
}))
const captured = vi.hoisted(() => ({ controller: undefined as OwnApiKeyController | undefined }))
vi.mock('@/entities/api-key', async (original) => ({
  ...(await original<typeof KeyEntity>()),
  OwnKeyOrganizationPicker: ({ controller }: { controller: OwnApiKeyController }) => {
    captured.controller = controller
    return null
  },
}))
const network = {
  list: vi.fn<(signal?: AbortSignal | null) => Promise<ApiKeyListResponse>>(),
  revoke: vi.fn<() => Promise<{ revoked: true }>>(),
}
const t = messages.ownApiKeys
const admission = { binding: 'a'.repeat(64), actorId: 'actor' }
const all: ApiKeyQuery = { page: 1, limit: 20, status: 'all' }
const key = (query = all) => ['own-api-keys', admission.binding, query]
const row: ApiKeyListItemResponse = {
  id: 'key-a',
  name: 'Export',
  organizationId: 'cmp00000000000000000000000',
  organizationName: 'Acme',
  scopes: ['read:Organization'],
  createdAt: '2026-10-19T00:00:00Z',
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
  status: 'unexpired',
}
const list = (revoked = false): ApiKeyListResponse => ({
  data: [{ ...row, ...(revoked && { status: 'revoked', revokedAt: row.createdAt }) }],
  page: 1,
  limit: 20,
  total: 1,
})
beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(toast, 'add').mockReturnValue('toast')
  network.list.mockReset().mockResolvedValue(list())
  network.revoke.mockReset().mockResolvedValue({ revoked: true })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    const data = String(url).endsWith('/session')
      ? { verified: true }
      : options?.method === 'DELETE'
        ? await network.revoke()
        : options?.method === 'POST'
          ? {
              ...JSON.parse(String(options.body)),
              id: row.id,
              key: '<fake-secret>',
              expiresAt: null,
              createdAt: row.createdAt,
            }
          : await network.list(options?.signal)
    return Response.json(
      { binding: admission.binding, data },
      { status: options?.method === 'POST' ? 201 : 200 }
    )
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
function fixture(content: (controller: OwnApiKeyController) => ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: false } },
  })
  const controller = new OwnApiKeyController(admission)
  const untouched = [
    ['own-api-keys', 'other-binding', all],
    ['own-api-key-organizations', admission.binding],
  ]
  untouched.forEach((queryKey) => client.setQueryData(queryKey, 'untouched'))
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {content(controller)}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
  return { client, controller, untouched }
}
function Inventory({ controller }: { controller: OwnApiKeyController }) {
  const [query, setQuery] = useState(all)
  return (
    <OwnApiKeys
      controller={controller}
      disabled={false}
      query={query}
      invalidQuery={false}
      onQueryChange={setQuery}
    />
  )
}
async function confirm() {
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: t.revoke }))
}
function expectUntouched(f: ReturnType<typeof fixture>) {
  f.untouched.forEach((queryKey) => {
    expect(f.client.getQueryData(queryKey)).toBe('untouched')
    expect(f.client.getQueryState(queryKey)?.isInvalidated).toBe(false)
  })
}
it('refreshes a previously visited filter after the real inventory confirmation', async () => {
  const f = fixture((controller) => <Inventory controller={controller} />)
  await screen.findByRole('button', { name: row.name })
  fireEvent.click(screen.getByRole('button', { name: t.unexpired }))
  await waitFor(() => expect(network.list).toHaveBeenCalledTimes(2))
  fireEvent.click(
    await screen.findByRole('button', { name: t.rowActions.replace('{name}', row.name) })
  )
  fireEvent.click(await screen.findByRole('menuitem', { name: t.revoke }))
  network.list.mockResolvedValue(list(true))
  await confirm()
  await waitFor(() => expect(f.client.getQueryState(key())?.isInvalidated).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: t.all }))
  await waitFor(() => expect(network.list).toHaveBeenCalledTimes(4))
  await waitFor(() => expect(f.client.getQueryData(key())).toEqual(list(true)))
  expect(network.revoke).toHaveBeenCalledOnce()
  expectUntouched(f)
})

function ExportedRevoke({
  controller,
  done,
}: {
  controller: OwnApiKeyController
  done: () => void
}) {
  useOwnApiKeys(controller, all)
  return (
    <OwnApiKeyRevoke
      controller={controller}
      id={row.id}
      name={row.name}
      disabled={false}
      onRevoked={done}
    />
  )
}
function entryFixture(mode: 'hook' | 'host', done = vi.fn()) {
  const f = fixture((controller) =>
    mode === 'host' ? (
      <OwnApiKeysHost
        admission={admission}
        query={all}
        invalidQuery={false}
        baseHref="/settings/api-keys"
      />
    ) : (
      <ExportedRevoke controller={controller} done={done} />
    )
  )
  return { ...f, controller: mode === 'host' ? captured.controller! : f.controller }
}
async function revokeFrom(mode: 'hook' | 'host', controller: OwnApiKeyController) {
  if (mode === 'host') {
    await act(async () => {
      await controller.create({
        name: row.name,
        organizationId: row.organizationId,
        scopes: row.scopes,
      })
    })
    expect(controller.getSnapshot().phase).toBe('createdSecretLost')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: t.openResult })))
  }
  fireEvent.click(screen.getByRole('button', { name: t.revoke }))
  await confirm()
}
it('confirms exported revoke before a held GET fails', async () => {
  const response = Promise.withResolvers<ApiKeyListResponse>()
  const done = vi.fn()
  const f = fixture((controller) => <ExportedRevoke controller={controller} done={done} />)
  await waitFor(() => expect(f.client.getQueryData(key())).toEqual(list()))
  network.list.mockReturnValueOnce(response.promise)
  fireEvent.click(screen.getByRole('button', { name: t.revoke }))
  await confirm()
  await waitFor(() => expect(done).toHaveBeenCalledOnce())
  expect(network.list).toHaveBeenCalledTimes(2)
  expect(f.client.getQueryState(key())?.fetchStatus).toBe('fetching')
  expect(f.controller.getRevocationSnapshot().phase).toBe('confirmed')
  await act(async () => {
    response.reject(new Error('read failed'))
  })
  await waitFor(() => expect(f.client.getQueryState(key())?.status).toBe('error'))
  network.list.mockResolvedValue(list(true))
  await act(() => f.client.refetchQueries({ queryKey: key() }))
  expect(f.controller.getRevocationSnapshot().phase).toBe('confirmed')
  expect(network.revoke).toHaveBeenCalledOnce()
  expect(done).toHaveBeenCalledOnce()
  expectUntouched(f)
})

it.each(['hook', 'host'] as const)(
  'cancels a pending first read at the real %s boundary',
  async (mode) => {
    const old = Promise.withResolvers<ApiKeyListResponse>(),
      replacement = Promise.withResolvers<ApiKeyListResponse>()
    network.list.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise)
    const done = vi.fn()
    const f = entryFixture(mode, done)
    const { controller } = f
    await waitFor(() => expect(network.list).toHaveBeenCalledOnce())
    expect(f.client.getQueryData(key())).toBeUndefined()
    await revokeFrom(mode, controller)
    await waitFor(() => expect(network.list).toHaveBeenCalledTimes(2))
    expect(network.list.mock.calls[0]![0]?.aborted).toBe(true)
    expect(controller.getRevocationSnapshot().phase).toBe('confirmed')
    if (mode === 'host')
      expect(toast.add).toHaveBeenCalledWith({ type: 'success', title: t.revokeSuccess })
    else expect(done).toHaveBeenCalledOnce()
    await act(async () => old.resolve(list()))
    expect(f.client.getQueryData(key())).toBeUndefined()
    await act(async () => replacement.reject(new Error('replacement unavailable')))
    await waitFor(() => expect(f.client.getQueryState(key())?.status).toBe('error'))
    expect(controller.getRevocationSnapshot().phase).toBe('confirmed')
    expect(network.revoke).toHaveBeenCalledOnce()
    expectUntouched(f)
  }
)

it.each(['hook', 'host'] as const)(
  'does not recreate retired data after late DELETE through %s',
  async (mode) => {
    const deletion = Promise.withResolvers<{ revoked: true }>()
    network.revoke.mockReturnValueOnce(deletion.promise)
    const f = entryFixture(mode)
    const { controller } = f
    await waitFor(() => expect(f.client.getQueryData(key())).toEqual(list()))
    await revokeFrom(mode, controller)
    await waitFor(() => expect(network.revoke).toHaveBeenCalledOnce())
    act(() => {
      controller.session.retire()
      f.client.removeQueries({ queryKey: ['own-api-keys', admission.binding] })
    })
    await act(async () => deletion.resolve({ revoked: true }))
    expect(f.client.getQueryState(key())).toBeUndefined()
    expect(network.list).toHaveBeenCalledOnce()
    expect(controller.getRevocationSnapshot().phase).toBe('idle')
    expect(f.client.getQueryData(f.untouched[0]!)).toBe('untouched')
    expect(f.client.getQueryState(f.untouched[0]!)?.isInvalidated).toBe(false)
  }
)
