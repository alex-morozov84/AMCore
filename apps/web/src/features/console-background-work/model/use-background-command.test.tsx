import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { AuthErrorCode, DEFAULT_LOCALE, type WorkReceipt } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/console-api', () => ({
  consoleApi: {
    requestBackgroundWorkCommand: vi.fn(),
    getBackgroundWorkReceipt: vi.fn(),
    stepUp: vi.fn(),
  },
}))
vi.mock('@/shared/ui/toast', () => ({ toast: { add: vi.fn() } }))

import { ApiNetworkError, ApiRequestError } from '@/shared/api'
import { consoleApi } from '@/shared/api/console-api'

import { useBackgroundCommand } from './use-background-command'

const input = {
  contractVersion: 1 as const,
  workId: 'image',
  operation: 'pause' as const,
  expectedWorkRevision: 'a'.repeat(64),
  targets: [],
  reason: 'Owner maintenance',
  parameters: {},
}
function receipt(commandId: string): WorkReceipt {
  return {
    commandId,
    workId: 'image',
    operation: 'pause',
    createdAt: new Date().toISOString(),
    revision: 2,
    state: 'applied',
    unknownCount: 0,
    targets: [{ id: 'image', state: 'applied', resolution: 'none' }],
  }
}
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <NextIntlClientProvider
      locale={DEFAULT_LOCALE}
      messages={{
        errors: {
          STEP_UP_REQUIRED: 'Confirm your password.',
          INVALID_CREDENTIALS: 'Incorrect password.',
          UNKNOWN_ERROR: 'The request failed.',
          NETWORK_ERROR: 'The connection failed.',
        },
      }}
    >
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
}
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.clearAllMocks()
  vi.mocked(consoleApi.requestBackgroundWorkCommand).mockImplementation(async (command) =>
    receipt(command.commandId)
  )
  vi.mocked(consoleApi.getBackgroundWorkReceipt).mockImplementation(async (id) => receipt(id))
  vi.mocked(consoleApi.stepUp).mockResolvedValue(undefined)
})

describe('immutable background command journey', () => {
  it('opens a retained receipt from the URL without reconstructing or posting a command', async () => {
    const id = '019a1234-1234-7123-8123-123456789012'
    window.history.replaceState(null, '', `/?receipt=${id}`)
    const hook = renderHook(useBackgroundCommand, { wrapper })
    await waitFor(() => expect(hook.result.current.receipt?.commandId).toBe(id))
    expect(hook.result.current.command).toBeNull()
    expect(consoleApi.requestBackgroundWorkCommand).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('reads retained receipts on browser history navigation without reposting the previous command', async () => {
    const first = '019a1234-1234-7123-8123-123456789012'
    const second = '019a1234-1234-7123-8123-123456789013'
    window.history.replaceState(null, '', `/?receipt=${first}`)
    const hook = renderHook(useBackgroundCommand, { wrapper })
    await waitFor(() => expect(hook.result.current.receipt?.commandId).toBe(first))
    act(() => {
      window.history.replaceState(null, '', `/?receipt=${second}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(hook.result.current.receipt?.commandId).toBe(second))
    expect(hook.result.current.command).toBeNull()
    expect(consoleApi.requestBackgroundWorkCommand).not.toHaveBeenCalled()
    act(() => {
      window.history.replaceState(null, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(hook.result.current.receiptId).toBeNull()
    hook.unmount()
  })
  it('captures the confirmation and prevents double POST even before pending state renders', async () => {
    const hook = renderHook(useBackgroundCommand, { wrapper })
    const captured = { ...input }
    act(() => {
      hook.result.current.prepare(captured)
    })
    captured.reason = 'Changed live input'
    await act(async () => {
      await Promise.all([hook.result.current.confirm(), hook.result.current.confirm()])
    })
    expect(consoleApi.requestBackgroundWorkCommand).toHaveBeenCalledTimes(1)
    expect(vi.mocked(consoleApi.requestBackgroundWorkCommand).mock.calls[0]![0].reason).toBe(
      input.reason
    )
    await waitFor(() => expect(hook.result.current.receipt?.state).toBe('applied'))
    hook.unmount()
  })

  it('recovers a lost POST acknowledgement with GET of the same identity', async () => {
    vi.mocked(consoleApi.requestBackgroundWorkCommand).mockRejectedValue(
      new ApiNetworkError('lost acknowledgement')
    )
    const hook = renderHook(useBackgroundCommand, { wrapper })
    act(() => {
      hook.result.current.prepare(input)
    })
    const id = hook.result.current.command!.commandId
    await act(async () => {
      await hook.result.current.confirm()
    })
    await waitFor(() => expect(hook.result.current.receipt?.commandId).toBe(id))
    expect(consoleApi.requestBackgroundWorkCommand).toHaveBeenCalledTimes(1)
    expect(consoleApi.getBackgroundWorkReceipt).toHaveBeenCalledWith(id, expect.any(AbortSignal))
    expect(hook.result.current.unconfirmed).toBe(false)
    hook.unmount()
  })

  it('treats an invalid success body as an unconfirmed command and reads the receipt', async () => {
    vi.mocked(consoleApi.requestBackgroundWorkCommand).mockResolvedValue({
      broken: true,
    } as unknown as WorkReceipt)
    const hook = renderHook(useBackgroundCommand, { wrapper })
    act(() => {
      hook.result.current.prepare(input)
    })
    await act(async () => {
      await hook.result.current.confirm()
    })
    await waitFor(() => expect(hook.result.current.receipt?.state).toBe('applied'))
    expect(consoleApi.requestBackgroundWorkCommand).toHaveBeenCalledTimes(1)
    expect(consoleApi.getBackgroundWorkReceipt).toHaveBeenCalled()
    hook.unmount()
  })

  it('keeps a definitive admission denial out of receipt reads and browser history', async () => {
    vi.mocked(consoleApi.requestBackgroundWorkCommand).mockRejectedValue(
      new ApiRequestError(409, {
        statusCode: 409,
        errorCode: 'CONTENT_UNSUPPORTED',
        message: 'Internal diagnostic',
        timestamp: new Date().toISOString(),
        path: '/commands',
        method: 'POST',
      })
    )
    const hook = renderHook(useBackgroundCommand, { wrapper })
    act(() => {
      hook.result.current.prepare(input)
    })
    expect(new URL(window.location.href).searchParams.has('receipt')).toBe(false)
    await act(async () => {
      await hook.result.current.confirm()
    })
    expect(hook.result.current.error).toBeInstanceOf(ApiRequestError)
    expect(hook.result.current.receiptId).toBeNull()
    expect(hook.result.current.unconfirmed).toBe(false)
    expect(consoleApi.getBackgroundWorkReceipt).not.toHaveBeenCalled()
    expect(new URL(window.location.href).searchParams.has('receipt')).toBe(false)
    hook.unmount()
  })

  it('dismisses a proven success without keeping a result address or enabling redispatch', async () => {
    const hook = renderHook(useBackgroundCommand, { wrapper })
    act(() => {
      hook.result.current.prepare(input)
    })
    await act(async () => {
      await hook.result.current.confirm()
    })
    await waitFor(() => expect(hook.result.current.receipt?.state).toBe('applied'))
    act(() => {
      hook.result.current.dismissSuccessfulReceipt()
    })
    expect(hook.result.current.receiptId).toBeNull()
    expect(new URL(window.location.href).searchParams.has('receipt')).toBe(false)
    await act(async () => {
      await hook.result.current.confirm()
    })
    expect(consoleApi.requestBackgroundWorkCommand).toHaveBeenCalledTimes(1)
    hook.unmount()
  })

  it('does not dismiss uncertainty as success', async () => {
    vi.mocked(consoleApi.requestBackgroundWorkCommand).mockImplementation(async (command) => ({
      ...receipt(command.commandId),
      state: 'partial',
      unknownCount: 1,
      targets: [{ id: 'image', state: 'unknown', resolution: 'none' }],
    }))
    vi.mocked(consoleApi.getBackgroundWorkReceipt).mockImplementation(async (id) => ({
      ...receipt(id),
      state: 'partial',
      unknownCount: 1,
      targets: [{ id: 'image', state: 'unknown', resolution: 'none' }],
    }))
    const hook = renderHook(useBackgroundCommand, { wrapper })
    act(() => {
      hook.result.current.prepare(input)
    })
    await act(async () => {
      await hook.result.current.confirm()
    })
    await waitFor(() => expect(hook.result.current.receipt?.unknownCount).toBe(1))
    const id = hook.result.current.receiptId
    act(() => {
      hook.result.current.dismissSuccessfulReceipt()
    })
    expect(hook.result.current.receiptId).toBe(id)
    expect(new URL(window.location.href).searchParams.get('receipt')).toBe(id)
    expect(consoleApi.requestBackgroundWorkCommand).toHaveBeenCalledTimes(1)
    hook.unmount()
  })

  it('opens the immutable older receipt after a newer command is dismissed, using GET only', async () => {
    const hook = renderHook(useBackgroundCommand, { wrapper })
    act(() => {
      hook.result.current.prepare(input)
    })
    const first = hook.result.current.command!.commandId
    await act(async () => {
      await hook.result.current.confirm()
    })
    await waitFor(() => expect(hook.result.current.receipt?.state).toBe('applied'))
    act(() => {
      hook.result.current.dismissSuccessfulReceipt()
      hook.result.current.prepare(input)
    })
    const second = hook.result.current.command!.commandId
    await act(async () => {
      await hook.result.current.confirm()
    })
    await waitFor(() => expect(hook.result.current.receipt?.commandId).toBe(second))
    act(() => {
      hook.result.current.dismissSuccessfulReceipt()
      hook.result.current.openReceipt(first)
    })
    await waitFor(() => expect(hook.result.current.receipt?.commandId).toBe(first))
    expect(new URL(window.location.href).searchParams.get('receipt')).toBe(first)
    expect(hook.result.current.command).toBeNull()
    expect(consoleApi.requestBackgroundWorkCommand).toHaveBeenCalledTimes(2)
    expect(consoleApi.getBackgroundWorkReceipt).toHaveBeenLastCalledWith(
      first,
      expect.any(AbortSignal)
    )
    await act(async () => {
      await hook.result.current.confirm()
    })
    expect(consoleApi.requestBackgroundWorkCommand).toHaveBeenCalledTimes(2)
    hook.unmount()
  })
  it('does not show a retained receipt after its authority is lost', async () => {
    const id = '019a1234-1234-7123-8123-123456789012'
    const hook = renderHook(useBackgroundCommand, { wrapper })
    act(() => {
      hook.result.current.openReceipt(id)
    })
    await waitFor(() => expect(hook.result.current.receipt?.commandId).toBe(id))
    vi.mocked(consoleApi.getBackgroundWorkReceipt).mockRejectedValue(
      new ApiRequestError(403, {
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        message: 'No access',
        timestamp: new Date().toISOString(),
        path: '/receipt',
        method: 'GET',
      })
    )
    await act(async () => {
      await hook.result.current.refreshReceipt()
    })
    await waitFor(() => expect(hook.result.current.receipt).toBeNull())
    expect(consoleApi.requestBackgroundWorkCommand).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('uses the same frozen ID for the single retry after definitive step-up denial', async () => {
    vi.mocked(consoleApi.requestBackgroundWorkCommand).mockRejectedValueOnce(
      new ApiRequestError(403, {
        statusCode: 403,
        errorCode: AuthErrorCode.STEP_UP_REQUIRED,
        message: 'Not user-facing',
        timestamp: new Date().toISOString(),
        path: '/background-work/commands',
        method: 'POST',
      })
    )
    const hook = renderHook(useBackgroundCommand, { wrapper })
    act(() => {
      hook.result.current.prepare(input)
    })
    await act(async () => {
      await hook.result.current.confirm()
    })
    expect(hook.result.current.stepUp.kind).toBe('open')
    expect(consoleApi.getBackgroundWorkReceipt).not.toHaveBeenCalled()
    act(() => {
      expect(hook.result.current.prepare({ ...input, reason: 'Different confirmation' })).toBe(
        false
      )
    })
    await act(async () => {
      await hook.result.current.submitStepUp('<fake password>')
    })
    const sent = vi.mocked(consoleApi.requestBackgroundWorkCommand).mock.calls
    expect(sent).toHaveLength(2)
    expect(sent[0]![0]).toEqual(sent[1]![0])
    expect(hook.result.current.stepUp.kind).toBe('closed')
    hook.unmount()
  })
})
