import type { PropsWithChildren } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createInvitationOperationId, DEFAULT_LOCALE } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { administrationClient as api } from '@/shared/api/console/administration-client'
import { provisioningClient } from '@/shared/api/console/provisioning-client'
import { consoleApi } from '@/shared/api/console-api'
import { ApiRequestError } from '@/shared/api/http-client'

import { type AdministratorPending, writeAdministratorJournal } from './command-journal'
import { useAdministratorCommand } from './use-administrator-command'

vi.mock('@/shared/api/console/administration-client', () => ({
  administrationClient: { command: vi.fn(), lookup: vi.fn() },
}))
vi.mock('@/shared/api/console/provisioning-client', () => ({
  provisioningClient: { session: vi.fn() },
}))
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/shared/api/console-api', () => ({ consoleApi: { stepUp: vi.fn() } }))
const admission = {
  binding: 'a'.repeat(64),
  actor: { id: 'operator', email: 'operator@example.test' },
}
const command = (): AdministratorPending => ({
  kind: 'create',
  input: {
    operationId: createInvitationOperationId(),
    email: 'person@example.test',
    inviteLocale: DEFAULT_LOCALE,
    reason: 'TEST-49',
  },
})
const receipt = (operationId: string) => ({
  operationId,
  organizationId: 'org',
  administratorInvitationId: operationId,
  revision: 1,
})
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: PropsWithChildren) => (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{ errors: {} }}>
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  const success = vi.fn()
  return {
    ...renderHook((identity) => useAdministratorCommand(identity, 'org', success), {
      wrapper,
      initialProps: admission,
    }),
    success,
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(provisioningClient.session).mockResolvedValue(admission)
})
describe('administrator command recovery and identity', () => {
  it('keeps frozen input after lost response/reload and recovers without sending again', async () => {
    const pending = command()
    vi.mocked(api.command).mockRejectedValue(
      new ApiRequestError(503, {
        errorCode: 'ADMIN_OPERATION_UNCONFIRMED',
        message: 'Unconfirmed',
      } as never)
    )
    const first = mount()
    await waitFor(() => expect(first.result.current.ready).toBe(true))
    await act(() => first.result.current.submit(pending))
    expect(first.result.current.record?.pending).toEqual(pending)
    first.unmount()
    const second = mount()
    await waitFor(() => expect(second.result.current.ready).toBe(true))
    expect(second.result.current.record?.pending).toEqual(pending)
    expect(api.command).toHaveBeenCalledTimes(1)
    vi.mocked(api.lookup).mockResolvedValue({ state: 'unknown', expiredUnrecorded: false })
    await act(() => second.result.current.check())
    expect(second.result.current.record?.operationId).toBe(pending.input.operationId)
    vi.mocked(api.lookup).mockResolvedValue({
      state: 'committed',
      receipt: receipt(pending.input.operationId),
    })
    await act(() => second.result.current.check())
    expect(second.result.current.record).toBeUndefined()
    expect(second.success).toHaveBeenCalledWith('create')
    expect(api.command).toHaveBeenCalledTimes(1)
  })
  it('allows closing an expired absent request only after serialized server proof', async () => {
    const operationId = createInvitationOperationId(Date.now() - 2 * 86400000)
    writeAdministratorJournal('org', {
      actorId: admission.actor.id,
      operationId,
      at: Date.now() - 2 * 86400000,
    })
    const view = mount()
    await waitFor(() => expect(view.result.current.ready).toBe(true))
    act(() => view.result.current.acknowledgeExpired())
    expect(view.result.current.record?.operationId).toBe(operationId)
    vi.mocked(api.lookup).mockResolvedValue({ state: 'unknown', expiredUnrecorded: true })
    await act(() => view.result.current.check())
    expect(view.result.current.expiredUnrecorded).toBe(true)
    act(() => view.result.current.acknowledgeExpired())
    expect(view.result.current.record).toBeUndefined()
    expect(api.command).not.toHaveBeenCalled()
  })
  it('retires an old actor callback before any command is sent', async () => {
    vi.mocked(provisioningClient.session).mockResolvedValue({
      binding: 'b'.repeat(64),
      actor: { id: 'another', email: 'another@example.test' },
    })
    const view = mount()
    await waitFor(() => expect(view.result.current.ready).toBe(true))
    await act(() => view.result.current.submit(command()))
    expect(view.result.current.retired).toBe(true)
    expect(api.command).not.toHaveBeenCalled()
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

describe('administrator operation callback isolation', () => {
  it.each(['success', 'expired', 'error'] as const)(
    'ignores late %s lookup A after lookup completes A and command B is frozen',
    async (outcome) => {
      const a = command()
      const b = command()
      const late = deferred<Awaited<ReturnType<typeof api.lookup>>>()
      vi.mocked(api.command).mockRejectedValue(new TypeError('lost response'))
      const view = mount()
      await waitFor(() => expect(view.result.current.ready).toBe(true))
      await act(() => view.result.current.submit(a))
      vi.mocked(api.lookup)
        .mockReturnValueOnce(late.promise)
        .mockResolvedValueOnce({ state: 'committed', receipt: receipt(a.input.operationId) })
      let checking!: Promise<void>
      act(() => {
        checking = view.result.current.check()
      })
      await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1))
      await act(() => view.result.current.check())
      await act(() => view.result.current.submit(b))
      const error = view.result.current.error
      await act(async () => {
        if (outcome === 'error') late.reject(new Error('late A error'))
        else
          late.resolve(
            outcome === 'success'
              ? { state: 'committed', receipt: receipt(a.input.operationId) }
              : { state: 'unknown', expiredUnrecorded: true }
          )
        await checking
      })
      expect(view.result.current.record?.pending).toEqual(b)
      expect(
        JSON.parse(localStorage.getItem('amcore:organization-administration:v1:org')!).pending
      ).toEqual(b)
      expect(view.result.current.error).toBe(error)
      expect(view.result.current.expiredUnrecorded).toBe(false)
      act(() => view.result.current.acknowledgeExpired())
      expect(view.result.current.record?.operationId).toBe(b.input.operationId)
      expect(view.success).toHaveBeenCalledTimes(1)
    }
  )
  it.each(['lookup-first', 'retry-first', 'late-success'] as const)(
    'isolates lookup from exact retry: %s',
    async (order) => {
      const a = command()
      const late = deferred<Awaited<ReturnType<typeof api.lookup>>>()
      const retried = deferred<Awaited<ReturnType<typeof api.command>>>()
      vi.mocked(api.command)
        .mockRejectedValueOnce(new TypeError('lost'))
        .mockReturnValueOnce(retried.promise)
      const view = mount()
      await waitFor(() => expect(view.result.current.ready).toBe(true))
      await act(() => view.result.current.submit(a))
      vi.mocked(api.lookup).mockReturnValueOnce(late.promise)
      let lookup!: Promise<void>
      let retry!: Promise<void>
      if (order === 'lookup-first') {
        act(() => {
          lookup = view.result.current.check()
        })
        await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1))
        act(() => {
          retry = view.result.current.mutation.confirm()
        })
        await waitFor(() => expect(api.command).toHaveBeenCalledTimes(2))
        await act(async () => {
          late.resolve({ state: 'unknown', expiredUnrecorded: true })
          await lookup
        })
        expect(view.result.current.expiredUnrecorded).toBe(false)
        await act(async () => {
          retried.resolve(receipt(a.input.operationId))
          await retry
        })
      } else {
        act(() => {
          retry = view.result.current.mutation.confirm()
        })
        await waitFor(() => expect(api.command).toHaveBeenCalledTimes(2))
        act(() => {
          lookup = view.result.current.check()
        })
        await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1))
        await act(async () => {
          late.resolve({ state: 'committed', receipt: receipt(a.input.operationId) })
          await lookup
        })
        const b = command()
        vi.mocked(api.command).mockRejectedValue(new TypeError('B lost'))
        await act(() => view.result.current.submit(b))
        await act(async () => {
          if (order === 'late-success') retried.resolve(receipt(a.input.operationId))
          else
            retried.reject(
              new ApiRequestError(409, {
                errorCode: 'ADMIN_INTENT_MISMATCH',
                message: 'late',
              } as never)
            )
          await retry
        })
        expect(view.result.current.record?.pending).toEqual(b)
      }
      expect(view.success).toHaveBeenCalledTimes(1)
    }
  )
  it('does not apply an old unmounted lookup to the persisted journal', async () => {
    const a = command()
    vi.mocked(api.command).mockRejectedValue(new TypeError('lost'))
    const view = mount()
    await waitFor(() => expect(view.result.current.ready).toBe(true))
    await act(() => view.result.current.submit(a))
    const late = deferred<Awaited<ReturnType<typeof api.lookup>>>()
    vi.mocked(api.lookup).mockReturnValue(late.promise)
    let lookup!: Promise<void>
    act(() => {
      lookup = view.result.current.check()
    })
    await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1))
    view.unmount()
    const before = localStorage.getItem('amcore:organization-administration:v1:org')
    await act(async () => {
      late.resolve({ state: 'committed', receipt: receipt(a.input.operationId) })
      await lookup
    })
    expect(localStorage.getItem('amcore:organization-administration:v1:org')).toBe(before)
    expect(view.success).not.toHaveBeenCalled()
  })
})

it('fences lookup across a new session lifecycle for the same operator', async () => {
  const a = command()
  vi.mocked(api.command).mockRejectedValue(new TypeError('lost'))
  const view = mount()
  await waitFor(() => expect(view.result.current.ready).toBe(true))
  await act(() => view.result.current.submit(a))
  const late = deferred<Awaited<ReturnType<typeof api.lookup>>>()
  vi.mocked(api.lookup).mockReturnValue(late.promise)
  let reading!: Promise<void>
  act(() => {
    reading = view.result.current.check()
  })
  await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1))
  const next = { ...admission, binding: 'b'.repeat(64) }
  vi.mocked(provisioningClient.session).mockResolvedValue(next)
  view.rerender(next)
  const saved = localStorage.getItem('amcore:organization-administration:v1:org')
  await act(async () => {
    late.resolve({ state: 'unknown', expiredUnrecorded: true })
    await reading
  })
  expect(view.result.current.record?.operationId).toBe(a.input.operationId)
  expect(view.result.current.expiredUnrecorded).toBe(false)
  expect(view.result.current.retired).toBe(false)
  expect(localStorage.getItem('amcore:organization-administration:v1:org')).toBe(saved)
})
it('keeps the exact command during step-up, including cancellation and explicit retry', async () => {
  const a = command()
  vi.mocked(api.command)
    .mockRejectedValueOnce(
      new ApiRequestError(403, { errorCode: 'STEP_UP_REQUIRED', message: 'Fresh login' } as never)
    )
    .mockResolvedValue(receipt(a.input.operationId))
  vi.mocked(consoleApi.stepUp).mockResolvedValue(undefined as never)
  const view = mount()
  await waitFor(() => expect(view.result.current.ready).toBe(true))
  await act(() => view.result.current.submit(a))
  expect(view.result.current.mutation.stepUp.kind).toBe('open')
  expect(view.result.current.busy).toBe(true)
  expect(view.result.current.record?.pending).toEqual(a)
  act(() => view.result.current.mutation.closeStepUp())
  expect(view.result.current.record?.pending).toEqual(a)
  vi.mocked(api.command).mockRejectedValueOnce(
    new ApiRequestError(403, { errorCode: 'STEP_UP_REQUIRED', message: 'Fresh login' } as never)
  )
  await act(() => view.result.current.mutation.confirm())
  await act(() => view.result.current.mutation.submitStepUp('<test-password>'))
  expect(api.command).toHaveBeenCalledTimes(3)
  for (const call of vi.mocked(api.command).mock.calls) expect(call[3]).toEqual(a.input)
  expect(view.result.current.record).toBeUndefined()
})

it('invalidates an old terminal proof synchronously when another lookup starts', async () => {
  vi.mocked(api.command).mockRejectedValue(new TypeError('lost'))
  const view = mount()
  await waitFor(() => expect(view.result.current.ready).toBe(true))
  const pending = command()
  await act(() => view.result.current.submit(pending))
  vi.mocked(api.lookup).mockResolvedValueOnce({ state: 'unknown', expiredUnrecorded: true })
  await act(() => view.result.current.check())
  const oldView = view.result.current
  expect(oldView.expiredUnrecorded).toBe(true)
  const next = deferred<Awaited<ReturnType<typeof api.lookup>>>()
  vi.mocked(api.lookup).mockReturnValue(next.promise)
  let reading!: Promise<void>
  act(() => {
    reading = oldView.check()
    oldView.acknowledgeExpired()
  })
  expect(view.result.current.record?.pending).toEqual(pending)
  await act(async () => {
    next.resolve({ state: 'unknown', expiredUnrecorded: false })
    await reading
  })
})
