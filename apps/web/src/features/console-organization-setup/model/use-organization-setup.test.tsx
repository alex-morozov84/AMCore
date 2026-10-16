import type { PropsWithChildren } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { establishmentConsoleClient as api } from '@/shared/api/console/establishment-client'
import { ApiRequestError } from '@/shared/api/http-client'

import { readSetupJournal, writeSetupJournal } from './journal'
import { useOrganizationSetup } from './use-organization-setup'

vi.mock('@/shared/api/console/establishment-client', () => ({
  establishmentConsoleClient: {
    session: vi.fn(),
    status: vi.fn(),
    account: vi.fn(),
    prepare: vi.fn(),
    bootstrap: vi.fn(),
  },
}))
const admission = {
  binding: 'a'.repeat(64),
  actor: { id: 'operator', email: 'operator@example.test' },
}
const input = { email: 'anna@example.test', locale: DEFAULT_LOCALE }
const selected = {
  userId: 'anna',
  email: input.email,
  emailVerified: false,
  state: 'eligible-empty' as const,
}
function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, notifyOnChangeProps: 'all' },
      mutations: { retry: false },
    },
  })
  const wrapper = ({ children }: PropsWithChildren) => (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{ errors: {} }}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  return renderHook(() => useOrganizationSetup(admission), { wrapper })
}
beforeEach(() => {
  sessionStorage.clear()
  vi.resetAllMocks()
  vi.mocked(api.session).mockResolvedValue(admission)
  vi.mocked(api.status).mockResolvedValue({ state: 'eligible-empty' })
  vi.mocked(api.prepare).mockResolvedValue({
    status: 'created',
    userId: 'anna',
    emailVerified: false,
    nextAction: 'verify-email',
  })
  vi.mocked(api.account).mockResolvedValue(selected)
})

describe('initial setup session-bound recovery', () => {
  it('retains a missing selected ID across reload until explicit replacement, preserving company details', async () => {
    const original = { ...selected, emailVerified: true }
    const draft = { email: input.email, name: 'Anna shop', slug: 'anna-shop' }
    writeSetupJournal({
      version: 1,
      binding: admission.binding,
      actorId: admission.actor.id,
      draft,
      selected: original,
      step: 'review',
    })
    vi.mocked(api.account).mockRejectedValue(new ApiRequestError(404, undefined))
    const first = mount()
    await waitFor(() => expect(first.result.current.account.isError).toBe(true))
    expect(first.result.current.record?.selected?.userId).toBe('anna')
    expect(api.prepare).not.toHaveBeenCalled()
    first.unmount()
    const second = mount()
    await waitFor(() => expect(second.result.current.account.isError).toBe(true))
    expect(second.result.current.record?.selected?.userId).toBe('anna')
    await act(async () => second.result.current.changeRecipient())
    expect(second.result.current.record).toMatchObject({
      draft,
      previousRecipientId: 'anna',
      step: 'administrator',
    })
    expect(second.result.current.record?.selected).toBeUndefined()
    // Even the same email must resolve a new ID explicitly and recheck mailbox proof.
    const replacement = { ...selected, userId: 'replacement', emailVerified: false }
    vi.mocked(api.prepare).mockResolvedValue({
      status: 'created',
      userId: 'replacement',
      emailVerified: false,
      nextAction: 'verify-email',
    })
    vi.mocked(api.account).mockResolvedValue(replacement)
    await act(async () => second.result.current.submit({ kind: 'prepare', input }))
    await waitFor(() => expect(second.result.current.account.isSuccess).toBe(true))
    expect(second.result.current.record).toMatchObject({
      draft,
      selected: replacement,
      step: 'administrator',
    })
    expect(api.account).toHaveBeenCalledWith(
      admission.binding,
      'replacement',
      expect.any(AbortSignal)
    )
    await act(async () => second.result.current.goTo('review'))
    expect(second.result.current.record?.step).toBe('administrator')
    expect(api.bootstrap).not.toHaveBeenCalled()
  })

  it.each(['pending', 'closed'] as const)(
    'never replaces the missing recipient when %s',
    async (state) => {
      const pending = {
        kind: 'bootstrap' as const,
        input: { name: 'Anna shop', slug: 'anna-shop', adminUserId: 'anna' },
      }
      writeSetupJournal({
        version: 1,
        binding: admission.binding,
        actorId: admission.actor.id,
        draft: { email: input.email, name: 'Anna shop', slug: 'anna-shop' },
        selected,
        ...(state === 'pending' ? { pending } : {}),
      })
      if (state === 'closed')
        vi.mocked(api.status).mockResolvedValue({ state: 'existing-org-without-receipt' })
      vi.mocked(api.account).mockRejectedValue(new ApiRequestError(404, undefined))
      const { result } = mount()
      await waitFor(() => expect(result.current.status.isSuccess).toBe(true))
      await act(async () => result.current.changeRecipient())
      expect(result.current.editable).toBe(false)
      expect(result.current.record?.selected).toEqual(selected)
      if (state === 'pending') expect(result.current.record?.pending).toEqual(pending)
      expect(api.prepare).not.toHaveBeenCalled()
    }
  )

  it('keeps unconfirmed accounts on the administrator step and prevents skipping ahead', async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.editable).toBe(true))
    await act(async () => result.current.submit({ kind: 'prepare', input }))
    await waitFor(() => expect(result.current.record).toMatchObject({ selected }))
    await waitFor(() => expect(result.current.editable).toBe(true))
    expect(result.current.record?.step).toBe('administrator')
    await act(async () => result.current.goTo('organization'))
    await act(async () => result.current.review({ name: 'Anna shop', slug: 'anna-shop' }))
    expect(result.current.record?.step).toBe('administrator')
    expect(api.bootstrap).not.toHaveBeenCalled()
  })

  it('preserves the review and entered details across back navigation and reload', async () => {
    const verified = { ...selected, emailVerified: true }
    vi.mocked(api.prepare).mockResolvedValue({
      status: 'existing',
      userId: 'anna',
      emailVerified: true,
      nextAction: 'sign-in',
    })
    vi.mocked(api.account).mockResolvedValue(verified)
    const first = mount()
    await waitFor(() => expect(first.result.current.editable).toBe(true))
    await act(async () => first.result.current.submit({ kind: 'prepare', input }))
    await waitFor(() => expect(first.result.current.record).toMatchObject({ selected: verified }))
    await waitFor(() => expect(first.result.current.editable).toBe(true))
    await waitFor(() => expect(first.result.current.account.isFetching).toBe(false))
    expect(first.result.current.account.data?.emailVerified).toBe(true)
    expect(first.result.current.record?.step).toBe('organization')
    await act(async () => first.result.current.review({ name: 'Anna shop', slug: 'anna-shop' }))
    expect(first.result.current.record?.step).toBe('review')
    await act(async () => first.result.current.goTo('organization'))
    expect(first.result.current.record?.draft).toMatchObject({
      name: 'Anna shop',
      slug: 'anna-shop',
    })
    await act(async () => first.result.current.review({ name: 'Anna shop', slug: 'anna-shop' }))
    first.unmount()
    const second = mount()
    await waitFor(() => expect(second.result.current.account.isSuccess).toBe(true))
    expect(second.result.current.record?.step).toBe('review')
    expect(second.result.current.record?.draft).toMatchObject({
      name: 'Anna shop',
      slug: 'anna-shop',
    })
    expect(api.prepare).toHaveBeenCalledTimes(1)
    expect(api.bootstrap).not.toHaveBeenCalled()
    await waitFor(() => expect(second.result.current.editable).toBe(true))
    await act(async () => second.result.current.changeRecipient())
    expect(second.result.current.record?.selected).toBeUndefined()
    expect(second.result.current.record?.step).toBe('administrator')
  })

  it('restores a pending preparation without submitting it on reload', async () => {
    writeSetupJournal({
      version: 1,
      binding: admission.binding,
      actorId: admission.actor.id,
      draft: { email: input.email, name: '', slug: '' },
      pending: { kind: 'prepare', input },
    })
    const { result } = mount()
    await waitFor(() => expect(result.current.status.isSuccess).toBe(true))
    expect(result.current.editable).toBe(false)
    expect(result.current.uncertain).toBe(true)
    expect(api.prepare).not.toHaveBeenCalled()
    await act(async () => result.current.repeat())
    await waitFor(() => expect(result.current.record?.selected).toEqual(selected))
    expect(api.prepare).toHaveBeenCalledWith(admission.binding, input, expect.any(AbortSignal))
    expect(result.current.record?.pending).toBeUndefined()
  })

  it('does not publish a preparation response under a changed operator identity', async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.editable).toBe(true))
    vi.mocked(api.prepare).mockImplementationOnce(async () => {
      vi.mocked(api.session).mockResolvedValue({
        binding: 'b'.repeat(64),
        actor: { id: 'other', email: 'other@example.test' },
      })
      return { status: 'created', userId: 'anna', emailVerified: false, nextAction: 'verify-email' }
    })
    await act(async () => result.current.submit({ kind: 'prepare', input }))
    await waitFor(() => expect(result.current.retired).toBe(true))
    expect(result.current.record?.selected).toBeUndefined()
    expect(api.account).not.toHaveBeenCalled()
    expect(readSetupJournal(admission.binding, admission.actor.id)?.pending).toEqual({
      kind: 'prepare',
      input,
    })
  })

  it('retains the frozen request when its consumer unmounts before acknowledgment', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof api.prepare>>) => void
    vi.mocked(api.prepare).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    const { result, unmount } = mount()
    await waitFor(() => expect(result.current.editable).toBe(true))
    await act(async () => result.current.submit({ kind: 'prepare', input }))
    await waitFor(() => expect(api.prepare).toHaveBeenCalledTimes(1))
    unmount()
    await act(async () =>
      resolve({
        status: 'created',
        userId: 'anna',
        emailVerified: false,
        nextAction: 'verify-email',
      })
    )
    const saved = readSetupJournal(admission.binding, admission.actor.id)
    expect(saved?.pending).toEqual({ kind: 'prepare', input })
    expect(saved?.selected).toBeUndefined()
  })

  it('offers no new account preparation on an already nonempty installation', async () => {
    vi.mocked(api.status).mockResolvedValue({ state: 'existing-org-without-receipt' })
    const { result } = mount()
    await waitFor(() => expect(result.current.status.isSuccess).toBe(true))
    await act(async () => result.current.submit({ kind: 'prepare', input }))
    expect(result.current.editable).toBe(false)
    expect(api.prepare).not.toHaveBeenCalled()
  })
})
