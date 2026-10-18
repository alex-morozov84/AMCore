import type { PropsWithChildren } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createInvitationOperationId, DEFAULT_LOCALE } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { provisioningClient as api } from '@/shared/api/console/provisioning-client'
import { consoleApi } from '@/shared/api/console-api'
import { ApiRequestError } from '@/shared/api/http-client'

import { writeProvisioningJournal } from './journal'
import { useProvisioning } from './use-provisioning'

vi.mock('@/shared/api/console/provisioning-client', () => ({
  provisioningClient: {
    session: vi.fn(),
    policy: vi.fn(),
    progress: vi.fn(),
    lookup: vi.fn(),
    create: vi.fn(),
    recover: vi.fn(),
  },
}))
vi.mock('@/shared/api/console-api', () => ({ consoleApi: { stepUp: vi.fn() } }))
const admission = {
  binding: 'a'.repeat(64),
  actor: { id: 'operator', email: 'operator@example.test' },
}
const draft = {
  name: 'North shop',
  slug: 'north-shop',
  firstAdminEmail: 'anna@example.test',
  inviteLocale: DEFAULT_LOCALE,
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: PropsWithChildren) => (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{ errors: {} }}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  return renderHook((identity) => useProvisioning(identity), { wrapper, initialProps: admission })
}
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(api.session).mockResolvedValue(admission)
  vi.mocked(api.policy).mockResolvedValue({ role: 'ADMIN', mailMode: 'mock', createAllowed: true })
})
describe('operator provisioning recovery', () => {
  it('keeps a frozen request across reload and unrecorded status; never auto-creates', async () => {
    const input = { ...draft, operationId: createInvitationOperationId() }
    writeProvisioningJournal(
      {
        version: 1,
        actorId: admission.actor.id,
        binding: admission.binding,
        at: Date.now(),
        open: true,
        step: 3,
        draft,
        pending: { kind: 'create', input },
      },
      'create'
    )
    const first = mount()
    await waitFor(() => expect(first.result.current.policy.isSuccess).toBe(true))
    expect(first.result.current.frozen).toBe(true)
    expect(api.create).not.toHaveBeenCalled()
    vi.mocked(api.lookup).mockResolvedValue({ state: 'unrecorded', sameIdAdmissible: true })
    await act(() => first.result.current.check())
    expect(first.result.current.record?.pending?.input.operationId).toBe(input.operationId)
    expect(api.create).not.toHaveBeenCalled()
    first.unmount()
    const second = mount()
    await waitFor(() =>
      expect(second.result.current.record?.pending?.input.operationId).toBe(input.operationId)
    )
    expect(api.create).not.toHaveBeenCalled()
  })
  it('preserves the draft for a clear slug conflict and clears the error on close', async () => {
    vi.mocked(api.create).mockRejectedValue(
      new ApiRequestError(409, {
        message: 'conflict',
        errorCode: 'PROVISIONING_SLUG_TAKEN',
      } as never)
    )
    const view = mount()
    await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
    act(() => view.result.current.edit(draft, 3))
    await act(() => view.result.current.submit())
    expect(view.result.current.record?.draft).toEqual(draft)
    expect(view.result.current.frozen).toBe(false)
    expect(view.result.current.error).toBeDefined()
    act(() => view.result.current.close())
    expect(view.result.current.error).toBeNull()
    act(() => view.result.current.start(DEFAULT_LOCALE))
    expect(view.result.current.record?.draft).toEqual(draft)
  })
  it('clears the lost-response error after recovering the original saved receipt', async () => {
    vi.mocked(api.create).mockRejectedValue(new TypeError('Controlled lost response'))
    const view = mount()
    await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
    act(() => view.result.current.edit(draft, 3))
    await act(() => view.result.current.submit())
    const operationId = view.result.current.record!.pending!.input.operationId
    expect(view.result.current.error).toBeDefined()
    vi.mocked(api.lookup).mockResolvedValue({
      state: 'committed',
      receipt: {
        operationId,
        organizationId: 'saved-organization',
        createdAt: new Date().toISOString(),
      },
    })
    vi.mocked(api.progress).mockResolvedValue({ organizationId: 'saved-organization' } as never)
    await act(() => view.result.current.check())
    expect(view.result.current.error).toBeNull()
    expect(view.result.current.frozen).toBe(false)
    expect(view.result.current.record?.organizationId).toBe('saved-organization')
    expect(api.create).toHaveBeenCalledTimes(1)
  })
  it('retires the old actor before sending a pending create', async () => {
    const view = mount()
    await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
    act(() => view.result.current.edit(draft, 3))
    vi.mocked(api.session).mockResolvedValue({
      ...admission,
      binding: 'b'.repeat(64),
      actor: { id: 'other', email: 'other@example.test' },
    })
    await act(() => view.result.current.submit())
    expect(view.result.current.retired).toBe(true)
    expect(api.create).not.toHaveBeenCalled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const creationReceipt = (operationId: string) => ({
  operationId,
  organizationId: 'saved-org',
  createdAt: new Date().toISOString(),
})
describe('creation operation callback isolation', () => {
  it.each(['success', 'expired', 'error'] as const)(
    'ignores late %s lookup A after B is frozen',
    async (outcome) => {
      vi.mocked(api.create).mockRejectedValue(new TypeError('lost response'))
      const view = mount()
      await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
      act(() => view.result.current.edit(draft, 3))
      await act(() => view.result.current.submit())
      const a = view.result.current.record!.pending!.input.operationId
      const late = deferred<Awaited<ReturnType<typeof api.lookup>>>()
      vi.mocked(api.lookup)
        .mockReturnValueOnce(late.promise)
        .mockResolvedValueOnce({ state: 'committed', receipt: creationReceipt(a) })
      let checking!: Promise<void>
      act(() => {
        checking = view.result.current.check()
      })
      await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1))
      await act(() => view.result.current.check())
      act(() => {
        view.result.current.start()
        view.result.current.edit({ ...draft, name: 'South shop' }, 3)
      })
      await act(() => view.result.current.submit())
      const b = view.result.current.record!.pending
      const error = view.result.current.error
      await act(async () => {
        if (outcome === 'error') late.reject(new Error('late A error'))
        else
          late.resolve(
            outcome === 'success'
              ? { state: 'committed', receipt: creationReceipt(a) }
              : { state: 'expired_unrecorded' }
          )
        await checking
      })
      expect(view.result.current.record?.pending).toEqual(b)
      expect(
        JSON.parse(localStorage.getItem('amcore:organization-provisioning:v1:create')!).pending
      ).toEqual(b)
      expect(view.result.current.error).toBe(error)
      expect(view.result.current.expiredAbsent).toBe(false)
      act(() => view.result.current.start())
      expect(view.result.current.record?.pending).toEqual(b)
    }
  )
  it('invalidates expired proof when an exact retry starts', async () => {
    vi.mocked(api.create).mockRejectedValueOnce(new TypeError('lost'))
    const view = mount()
    await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
    act(() => view.result.current.edit(draft, 3))
    await act(() => view.result.current.submit())
    const pending = view.result.current.record!.pending
    vi.mocked(api.lookup).mockResolvedValue({ state: 'expired_unrecorded' })
    await act(() => view.result.current.check())
    expect(view.result.current.expiredAbsent).toBe(true)
    const retry = deferred<Awaited<ReturnType<typeof api.create>>>()
    vi.mocked(api.create).mockReturnValue(retry.promise)
    let sending!: Promise<void>
    act(() => {
      sending = view.result.current.submit()
    })
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2))
    expect(view.result.current.expiredAbsent).toBe(false)
    act(() => view.result.current.start())
    expect(view.result.current.record?.pending).toEqual(pending)
    await act(async () => {
      retry.reject(new TypeError('still lost'))
      await sending
    })
  })
  it.each(['lookup-first', 'retry-first', 'late-success'] as const)(
    'keeps only the current lookup/retry attempt: %s',
    async (order) => {
      const late = deferred<Awaited<ReturnType<typeof api.lookup>>>()
      const retried = deferred<Awaited<ReturnType<typeof api.create>>>()
      vi.mocked(api.create)
        .mockRejectedValueOnce(new TypeError('lost'))
        .mockReturnValueOnce(retried.promise)
      const view = mount()
      await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
      act(() => view.result.current.edit(draft, 3))
      await act(() => view.result.current.submit())
      const a = view.result.current.record!.pending!.input.operationId
      vi.mocked(api.lookup).mockReturnValueOnce(late.promise)
      let lookup!: Promise<void>
      let retry!: Promise<void>
      if (order === 'lookup-first') {
        act(() => {
          lookup = view.result.current.check()
        })
        await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1))
        act(() => {
          retry = view.result.current.submit()
        })
        await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2))
        await act(async () => {
          late.resolve({ state: 'expired_unrecorded' })
          await lookup
        })
        expect(view.result.current.expiredAbsent).toBe(false)
        await act(async () => {
          retried.resolve(creationReceipt(a))
          await retry
        })
      } else {
        act(() => {
          retry = view.result.current.submit()
        })
        await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2))
        act(() => {
          lookup = view.result.current.check()
        })
        await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1))
        await act(async () => {
          late.resolve({ state: 'committed', receipt: creationReceipt(a) })
          await lookup
        })
        vi.mocked(api.create).mockRejectedValue(new TypeError('B lost'))
        act(() => {
          view.result.current.start()
          view.result.current.edit(draft, 3)
        })
        await act(() => view.result.current.submit())
        const b = view.result.current.record!.pending
        await act(async () => {
          if (order === 'late-success') retried.resolve(creationReceipt(a))
          else
            retried.reject(
              new ApiRequestError(409, {
                errorCode: 'PROVISIONING_SLUG_TAKEN',
                message: 'late',
              } as never)
            )
          await retry
        })
        expect(view.result.current.record?.pending).toEqual(b)
      }
    }
  )
  it('keeps storage unchanged after an unmounted lookup responds', async () => {
    vi.mocked(api.create).mockRejectedValue(new TypeError('lost'))
    const view = mount()
    await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
    act(() => view.result.current.edit(draft, 3))
    await act(() => view.result.current.submit())
    const a = view.result.current.record!.pending!.input.operationId
    const late = deferred<Awaited<ReturnType<typeof api.lookup>>>()
    vi.mocked(api.lookup).mockReturnValueOnce(late.promise)
    let lookup!: Promise<void>
    act(() => {
      lookup = view.result.current.check()
    })
    await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1))
    view.unmount()
    const before = localStorage.getItem('amcore:organization-provisioning:v1:create')
    await act(async () => {
      late.resolve({ state: 'committed', receipt: creationReceipt(a) })
      await lookup
    })
    expect(localStorage.getItem('amcore:organization-provisioning:v1:create')).toBe(before)
  })
})

it('fences a lookup after the same operator starts a new session lifecycle', async () => {
  vi.mocked(api.create).mockRejectedValue(new TypeError('lost'))
  const view = mount()
  await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
  act(() => view.result.current.edit(draft, 3))
  await act(() => view.result.current.submit())
  const a = view.result.current.record!.pending!.input.operationId
  const late = deferred<Awaited<ReturnType<typeof api.lookup>>>()
  vi.mocked(api.lookup).mockReturnValue(late.promise)
  let reading!: Promise<void>
  act(() => {
    reading = view.result.current.check()
  })
  await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1))
  const next = { ...admission, binding: 'b'.repeat(64) }
  vi.mocked(api.session).mockResolvedValue(next)
  view.rerender(next)
  await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
  const saved = localStorage.getItem('amcore:organization-provisioning:v1:create')
  await act(async () => {
    late.resolve({ state: 'committed', receipt: creationReceipt(a) })
    await reading
  })
  expect(localStorage.getItem('amcore:organization-provisioning:v1:create')).toBe(saved)
  expect(view.result.current.createdId).toBeUndefined()
  expect(view.result.current.expiredAbsent).toBe(false)
  expect(view.result.current.retired).toBe(false)
})
it('preserves the frozen creation through a step-up close and retry', async () => {
  vi.mocked(api.create).mockRejectedValue(
    new ApiRequestError(403, { errorCode: 'STEP_UP_REQUIRED', message: 'Fresh login' } as never)
  )
  const view = mount()
  await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
  act(() => view.result.current.edit(draft, 3))
  await act(() => view.result.current.submit())
  const a = view.result.current.record!.pending!
  expect(view.result.current.mutation.stepUp.kind).toBe('open')
  expect(view.result.current.busy).toBe(true)
  act(() => view.result.current.mutation.closeStepUp())
  expect(view.result.current.record?.pending).toEqual(a)
  await act(() => view.result.current.submit())
  vi.mocked(api.create).mockResolvedValue(creationReceipt(a.input.operationId))
  vi.mocked(consoleApi.stepUp).mockResolvedValue(undefined as never)
  await act(() => view.result.current.mutation.submitStepUp('<test-password>'))
  expect(api.create).toHaveBeenCalledTimes(3)
  for (const call of vi.mocked(api.create).mock.calls) expect(call[1]).toEqual(a.input)
  expect(view.result.current.frozen).toBe(false)
})

it('does not start a new creation using proof from an earlier lookup callback', async () => {
  vi.mocked(api.create).mockRejectedValue(new TypeError('lost'))
  const view = mount()
  await waitFor(() => expect(view.result.current.policy.isSuccess).toBe(true))
  act(() => view.result.current.edit(draft, 3))
  await act(() => view.result.current.submit())
  const pending = view.result.current.record!.pending
  vi.mocked(api.lookup).mockResolvedValueOnce({ state: 'expired_unrecorded' })
  await act(() => view.result.current.check())
  const oldView = view.result.current
  expect(oldView.expiredAbsent).toBe(true)
  const next = deferred<Awaited<ReturnType<typeof api.lookup>>>()
  vi.mocked(api.lookup).mockReturnValue(next.promise)
  let reading!: Promise<void>
  act(() => {
    reading = oldView.check()
    oldView.start()
  })
  expect(view.result.current.record?.pending).toEqual(pending)
  await act(async () => {
    next.resolve({ state: 'unrecorded', sameIdAdmissible: true })
    await reading
  })
})
