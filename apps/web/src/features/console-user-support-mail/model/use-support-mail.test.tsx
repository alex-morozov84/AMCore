import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import type { SupportMailFact, SupportMailPreparation, SupportMailStatus } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { consoleApi } from '@/shared/api/console-api'
import { ApiRequestError } from '@/shared/api/http-client'
import { toast } from '@/shared/ui/toast'

import en from '../../../../messages/en.json'

import { useSupportMail } from './use-support-mail'

vi.mock('@/shared/api/console-api', () => ({
  consoleApi: {
    getSupportMailStatus: vi.fn(),
    prepareSupportMail: vi.fn(),
    sendSupportMail: vi.fn(),
    getSupportMailReceipt: vi.fn(),
    stepUp: vi.fn(),
  },
}))
vi.mock('@/shared/ui/toast', () => ({ toast: { add: vi.fn() } }))
const preparation: SupportMailPreparation = {
  attemptId: '00000000-0000-4000-8000-000000000001',
  kind: 'password_recovery',
  recipient: 'person@example.test',
  expiresAt: '2026-10-24T12:30:00.000Z',
  linkLifetimeSeconds: 900,
}
const receipt: SupportMailFact = {
  evidence: 'stored',
  attemptId: preparation.attemptId,
  kind: preparation.kind,
  outcome: 'simulated',
  tokenIssued: true,
  provider: 'mock',
  reason: null,
  attemptedAt: '2026-10-24T12:00:00.000Z',
  settledAt: '2026-10-24T12:00:01.000Z',
  readUntil: '2026-10-25T12:00:00.000Z',
}
const status: SupportMailStatus = {
  serverNow: '2026-10-24T12:00:00.000Z',
  provider: 'mock',
  actions: ['email_verification', 'password_recovery'].map((kind) => ({
    kind,
    available: true,
    unavailableReason: null,
    retryAfterSeconds: 0,
    latest: null,
    resultExpired: false,
  })) as SupportMailStatus['actions'],
}
function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        {children}
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(consoleApi.getSupportMailStatus).mockResolvedValue(status)
  vi.mocked(consoleApi.prepareSupportMail).mockResolvedValue(preparation)
  vi.mocked(consoleApi.sendSupportMail).mockResolvedValue(receipt)
  vi.mocked(consoleApi.getSupportMailReceipt).mockResolvedValue(receipt)
})

describe('support mail immediate feedback', () => {
  it.each([
    new ApiRequestError(500, undefined),
    new ApiRequestError(502, undefined),
    new SyntaxError('malformed 2xx'),
    new TypeError('network'),
  ])('recovers an ambiguous POST using GET only', async (error) => {
    vi.mocked(consoleApi.sendSupportMail).mockRejectedValue(error)
    const view = renderHook(() => useSupportMail('target', 'operator'), { wrapper })
    await waitFor(() => expect(view.result.current.status.isSuccess).toBe(true))
    await act(async () => {
      await view.result.current.start('password_recovery')
    })
    act(() => {
      view.result.current.confirm()
      view.result.current.confirm()
    })
    await waitFor(() => expect(consoleApi.getSupportMailReceipt).toHaveBeenCalledTimes(1))
    expect(consoleApi.sendSupportMail).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(view.result.current.phase.kind).toBe('idle'))
  })

  it('does not trust no-effect details on an unrecognized server failure', async () => {
    vi.mocked(consoleApi.sendSupportMail).mockRejectedValue(
      new ApiRequestError(500, {
        message: 'failure',
        errorCode: 'UNKNOWN',
        details: { effect: 'none', tokenIssued: false },
      } as never)
    )
    const view = renderHook(() => useSupportMail('target', 'operator'), { wrapper })
    await waitFor(() => expect(view.result.current.status.isSuccess).toBe(true))
    await act(async () => {
      await view.result.current.start('password_recovery')
    })
    act(() => view.result.current.confirm())
    await waitFor(() => expect(consoleApi.getSupportMailReceipt).toHaveBeenCalledTimes(1))
    expect(consoleApi.sendSupportMail).toHaveBeenCalledTimes(1)
  })

  it('does not show late results or a toast after closing a pending send', async () => {
    let finish!: (value: SupportMailFact) => void
    vi.mocked(consoleApi.sendSupportMail).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const view = renderHook(() => useSupportMail('target', 'operator'), { wrapper })
    await waitFor(() => expect(view.result.current.status.isSuccess).toBe(true))
    await act(async () => {
      await view.result.current.start('password_recovery')
    })
    act(() => view.result.current.confirm())
    await waitFor(() => expect(view.result.current.phase.kind).toBe('sending'))
    act(() => view.result.current.close())
    await act(async () => finish(receipt))
    expect(view.result.current.phase.kind).toBe('idle')
    expect(toast.add).not.toHaveBeenCalled()
    act(() => view.result.current.reopen('password_recovery', receipt.attemptId))
    await waitFor(() => expect(view.result.current.phase.kind).toBe('result'))
    expect(consoleApi.sendSupportMail).toHaveBeenCalledTimes(1)
  })

  it('does not resume after a pending preparation is unmounted', async () => {
    let finish!: (value: SupportMailPreparation) => void
    vi.mocked(consoleApi.prepareSupportMail).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const view = renderHook(() => useSupportMail('target', 'operator'), { wrapper })
    await waitFor(() => expect(view.result.current.status.isSuccess).toBe(true))
    let start!: Promise<void>
    act(() => {
      start = view.result.current.start('password_recovery')
    })
    view.unmount()
    await act(async () => {
      finish(preparation)
      await start
    })
    expect(consoleApi.sendSupportMail).not.toHaveBeenCalled()
    expect(toast.add).not.toHaveBeenCalled()
  })

  it('uses one informational toast for a fresh simulated send and closes its modal', async () => {
    const view = renderHook(() => useSupportMail('target', 'operator'), { wrapper })
    await waitFor(() => expect(view.result.current.status.isSuccess).toBe(true))
    await act(async () => {
      await view.result.current.start('password_recovery')
    })
    await act(async () => {
      view.result.current.confirm()
    })
    await waitFor(() => expect(view.result.current.phase.kind).toBe('idle'))
    expect(consoleApi.sendSupportMail).toHaveBeenCalledTimes(1)
    expect(toast.add).toHaveBeenCalledTimes(1)
    expect(toast.add).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', title: en.console.supportMail.toast.simulated })
    )
  })

  it('reopens saved results without a new toast or send', async () => {
    const view = renderHook(() => useSupportMail('target', 'operator'), { wrapper })
    await waitFor(() => expect(view.result.current.status.isSuccess).toBe(true))
    act(() => view.result.current.reopen('password_recovery', receipt.attemptId))
    await waitFor(() => expect(view.result.current.phase.kind).toBe('result'))
    expect(consoleApi.getSupportMailReceipt).toHaveBeenCalledTimes(1)
    expect(consoleApi.sendSupportMail).not.toHaveBeenCalled()
    expect(toast.add).not.toHaveBeenCalled()
  })

  it('keeps a failed send explainable without stacking a second notification', async () => {
    vi.mocked(consoleApi.sendSupportMail).mockResolvedValue({
      ...receipt,
      outcome: 'not_started',
      reason: 'render_failed',
    } satisfies SupportMailFact)
    const view = renderHook(() => useSupportMail('target', 'operator'), { wrapper })
    await waitFor(() => expect(view.result.current.status.isSuccess).toBe(true))
    await act(async () => {
      await view.result.current.start('password_recovery')
    })
    await act(async () => {
      view.result.current.confirm()
    })
    await waitFor(() => expect(view.result.current.phase.kind).toBe('result'))
    expect(toast.add).not.toHaveBeenCalled()
  })
})
