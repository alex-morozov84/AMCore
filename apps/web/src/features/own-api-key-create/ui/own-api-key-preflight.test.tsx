import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { OwnApiKeyController } from '@/entities/api-key'

import { OwnApiKeyCreate } from './own-api-key-create'

vi.mock('client-only', () => ({}))
vi.mock('@/i18n/navigation', () => ({ Link: 'a', useRouter: () => ({}) }))
const messages = (await import(`../../../../messages/${DEFAULT_LOCALE}.json`)).default
const t = messages.ownApiKeys
const org = 'cmp00000000000000000000000'
function fixture() {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  let resolve!: (allowed: boolean) => void
  const authority = new Promise<boolean>((done) => {
    resolve = done
  })
  const verifyTarget = vi.fn().mockReturnValue(authority)
  const client = {
    verify: vi.fn().mockResolvedValue({ verified: true as const }),
    create: vi.fn().mockImplementation(async (_binding, input) => ({
      ...input,
      id: 'key-a',
      key: '<fake-secret>',
      expiresAt: null,
      createdAt: '2026-10-19T00:00:00Z',
    })),
    list: vi.fn(),
    revoke: vi.fn(),
  }
  const controller = new OwnApiKeyController({ binding: 'a'.repeat(64), actorId: 'actor' }, client)
  controller.setTarget(org)
  const view = render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages} timeZone="UTC">
      <OwnApiKeyCreate
        controller={controller}
        organizationId={org}
        organizationName="Acme"
        canCreate
        verifyTarget={verifyTarget}
        onInspect={async () => undefined}
      />
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: t.create }))
  fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'Submitted draft' } })
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: messages.organizationRoles.capabilities.organizationRead.label,
    })
  )
  fireEvent.click(screen.getAllByRole('button', { name: t.create }).at(-1)!)
  return { ...view, controller, client, verifyTarget, resolve, authority }
}
it.each([true, false])(
  'cancel/reopen rejects the old authority continuation (%s)',
  async (allowed) => {
    const f = fixture()
    await waitFor(() => expect(f.verifyTarget).toHaveBeenCalledOnce())
    expect(f.controller.getSnapshot().phase).toBe('preflight')
    expect(screen.getByRole('button', { name: t.create })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: t.cancel }))
    fireEvent.click(screen.getByRole('button', { name: t.create }))
    fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'New unsent draft' } })
    await act(async () => {
      f.resolve(allowed)
      await f.authority
    })
    expect(f.client.create).not.toHaveBeenCalled()
    expect(screen.getByLabelText(t.name)).toHaveValue('New unsent draft')
    expect(screen.queryByText(t.creationCheckFailed)).not.toBeInTheDocument()
  }
)
it('does not reread later fields and ignores a duplicate submit during authority verification', async () => {
  const f = fixture()
  await waitFor(() => expect(f.verifyTarget).toHaveBeenCalledOnce())
  fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'Later field value' } })
  fireEvent.submit(screen.getByLabelText(t.name).closest('form')!)
  await act(async () => {
    f.resolve(true)
    await f.authority
  })
  await waitFor(() => expect(f.client.create).toHaveBeenCalledOnce())
  expect(f.verifyTarget).toHaveBeenCalledOnce()
  expect(f.client.create.mock.calls[0]?.[1]).toMatchObject({
    name: 'Submitted draft',
    scopes: ['read:Organization'],
  })
})
it.each(['unmount', 'target'] as const)('invalidates authority preflight on %s', async (reason) => {
  const f = fixture()
  await waitFor(() => expect(f.verifyTarget).toHaveBeenCalledOnce())
  if (reason === 'unmount') f.unmount()
  else act(() => f.controller.setTarget('cmp00000000000000000000001'))
  await act(async () => {
    f.resolve(true)
    await f.authority
  })
  expect(f.client.create).not.toHaveBeenCalled()
  expect(f.controller.getSnapshot().phase).toBe('idle')
})
