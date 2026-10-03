import { NextIntlClientProvider } from 'next-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { consoleApi } from '@/shared/api/console-api'
import { ApiNetworkError, ApiRequestError } from '@/shared/api/http-client'

import en from '../../../../messages/en.json'

import { StorageProbeIntervalEditor } from './StorageProbeIntervalEditor'

vi.mock('@/shared/api/console-api', () => ({
  consoleApi: {
    getStorageProbeSetting: vi.fn(),
    updateStorageProbeSetting: vi.fn(),
    stepUp: vi.fn(),
  },
}))
vi.mock('@/shared/ui/toast', () => ({ toast: { add: vi.fn() } }))

const saved = (intervalSeconds: number | null = null, revision = 0) => ({
  saved: { intervalSeconds, revision },
  baselineSeconds: 600,
  applied: {
    intervalSeconds: 600,
    revision: 0,
    source: 'baseline' as const,
    lastConfirmedAt: '2026-10-02T00:00:00.000Z',
    refreshStatus: 'confirmed' as const,
    nextScheduledAt: null,
  },
})
function view() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <NextIntlClientProvider locale="en" messages={en}>
        <StorageProbeIntervalEditor observedInterval={600} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}
async function open() {
  return screen.findByRole('spinbutton')
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(consoleApi.getStorageProbeSetting).mockResolvedValue(saved())
  vi.mocked(consoleApi.updateStorageProbeSetting).mockResolvedValue(saved(60, 1))
})
describe('Overview interval editor', () => {
  it('loads authoritative saved value and shows actions only for a change', async () => {
    view()
    const input = await open()
    expect(input).toHaveValue(600)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    vi.mocked(consoleApi.getStorageProbeSetting).mockResolvedValue(saved(120, 2))
    fireEvent.change(input, { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(consoleApi.updateStorageProbeSetting).not.toHaveBeenCalled()
    await waitFor(() => expect(input).toHaveValue(120))
    expect(consoleApi.getStorageProbeSetting).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument()
  })
  it('saves 600 as an explicit override and explains application without technical details', async () => {
    vi.mocked(consoleApi.updateStorageProbeSetting).mockResolvedValue(saved(600, 1))
    vi.mocked(consoleApi.getStorageProbeSetting).mockResolvedValue(saved(60, 1))
    view()
    fireEvent.change(await open(), { target: { value: '600' } })
    vi.mocked(consoleApi.getStorageProbeSetting).mockResolvedValue(saved(600, 2))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(consoleApi.updateStorageProbeSetting).toHaveBeenCalledWith({
        intervalSeconds: 600,
        expectedRevision: 1,
      })
    )
    expect(await screen.findByText(en.console.storageSetting.applying)).toBeInTheDocument()
    expect(screen.queryByText(/revision|override|API process/)).not.toBeInTheDocument()
  })
  it('captures value/revision through step-up even when the saved setting changes', async () => {
    vi.mocked(consoleApi.updateStorageProbeSetting).mockRejectedValueOnce(
      new ApiRequestError(403, {
        timestamp: '2026-10-02T00:00:00.000Z',
        path: '/settings',
        method: 'PATCH',
        statusCode: 403,
        message: 'fresh auth required',
        errorCode: 'STEP_UP_REQUIRED',
      })
    )
    vi.mocked(consoleApi.stepUp).mockResolvedValue(undefined)
    view()
    fireEvent.change(await open(), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const password = await screen.findByLabelText('Password')
    vi.mocked(consoleApi.getStorageProbeSetting).mockResolvedValue(saved(120, 1))
    fireEvent.change(password, { target: { value: 'Demo!AMCore2026' } })
    fireEvent.click(screen.getByRole('button', { name: en.console.stepUpSubmit }))
    await waitFor(() => expect(consoleApi.updateStorageProbeSetting).toHaveBeenCalledTimes(2))
    expect(vi.mocked(consoleApi.updateStorageProbeSetting).mock.calls).toEqual([
      [{ intervalSeconds: 90, expectedRevision: 0 }],
      [{ intervalSeconds: 90, expectedRevision: 0 }],
    ])
  })
  it.each(['conflict', 'timeout'])(
    'preserves draft and rereads after %s without replay',
    async (kind) => {
      view()
      const input = await open()
      vi.mocked(consoleApi.getStorageProbeSetting).mockResolvedValue(saved(120, 1))
      vi.mocked(consoleApi.updateStorageProbeSetting).mockRejectedValueOnce(
        kind === 'conflict'
          ? new ApiRequestError(409, {
              timestamp: '2026-10-02T00:00:00.000Z',
              path: '/settings',
              method: 'PATCH',
              statusCode: 409,
              message: 'changed',
              errorCode: 'SETTING_REVISION_CONFLICT',
            })
          : new ApiNetworkError(new Error('timeout'))
      )
      fireEvent.change(input, { target: { value: '90' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(consoleApi.getStorageProbeSetting).toHaveBeenCalledTimes(2))
      expect(input).toHaveValue(90)
      expect(consoleApi.updateStorageProbeSetting).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(consoleApi.updateStorageProbeSetting).toHaveBeenLastCalledWith({
          intervalSeconds: 90,
          expectedRevision: 1,
        })
      )
    }
  )
  it('shows a loader and prevents duplicate submission while saving', async () => {
    let resolve!: (value: ReturnType<typeof saved>) => void
    vi.mocked(consoleApi.updateStorageProbeSetting).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    view()
    const input = await open()
    fireEvent.change(input, { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const pending = await screen.findByRole('button', { name: 'Saving…' })
    expect(pending).toBeDisabled()
    expect(pending.querySelector('svg')).toBeInTheDocument()
    expect(input).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.click(pending)
    expect(consoleApi.updateStorageProbeSetting).toHaveBeenCalledTimes(1)
    vi.mocked(consoleApi.getStorageProbeSetting).mockResolvedValue(saved(90, 1))
    resolve(saved(90, 1))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument()
    )
    expect(input).toHaveValue(90)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
  it('keeps the unavailable editor local and leaves the observed interval visible', async () => {
    vi.mocked(consoleApi.getStorageProbeSetting).mockRejectedValue(new Error('unavailable'))
    view()
    await screen.findByText(en.console.storageSetting.refreshFailed)
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.getByText('Check every 600 seconds')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
  })
})
