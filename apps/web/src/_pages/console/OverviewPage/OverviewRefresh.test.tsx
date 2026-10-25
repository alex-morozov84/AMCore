import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OverviewRefresh } from './OverviewRefresh'
const refresh = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ refresh }),
}))
const messages = {
  console: {
    overviewRefresh: 'Refresh',
    overviewRefreshing: 'Refreshing',
    problems: { retryWait: 'Wait {seconds} seconds' },
  },
}
const view = (delay: number, id = 'a') => (
  <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
    <OverviewRefresh retryAfterMs={delay} renderId={id} />
  </NextIntlClientProvider>
)
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
  refresh.mockReset()
})
afterEach(() => vi.useRealTimers())
describe('one manual Overview refresh', () => {
  it('honours a floor longer than five minutes and never fetches from its timer', async () => {
    const { rerender } = render(view(600000))
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    expect(screen.getByText('Wait 600 seconds')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByText('Wait 599 seconds')).toBeInTheDocument()
    rerender(view(0, 'b'))
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    await act(() => vi.advanceTimersByTimeAsync(599001))
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('blocks duplicate clicks while the refresh transition is pending', async () => {
    const gate = Promise.withResolvers<void>()
    refresh.mockReturnValue(gate.promise)
    render(view(0))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(screen.getByRole('button', { name: 'Refreshing' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Refreshing' }))
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => gate.resolve())
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })
  it('adds the new delay at hydration and retains a full-day provider floor', () => {
    render(view(86400000))
    expect(screen.getByText('Wait 86400 seconds')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(refresh).not.toHaveBeenCalled()
  })
})
