import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useIdentityLookup } from './use-identity-lookup'

type Search = Parameters<typeof useIdentityLookup>[0]
const reply = (id: string) => ({ items: [{ id, name: id }], hasMore: false })
const tick = (ms = 1) => act(() => vi.advanceTimersByTimeAsync(ms))
function mount(callback: Search, client = new QueryClient()) {
  return {
    client,
    ...renderHook(({ search }) => useIdentityLookup(search), {
      initialProps: { search: callback },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }),
  }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('shared lookup lifetime', () => {
  it('keeps threshold and timer across callback rerenders, without a duplicate Enter', async () => {
    const first = vi.fn<Search>(async () => reply('first'))
    const latest = vi.fn<Search>(async () => reply('latest'))
    const h = mount(first)
    act(() => h.result.current.change(' a '))
    await tick(400)
    expect(first).not.toHaveBeenCalled()
    expect(h.result.current.busy).toBe(false)
    act(() => h.result.current.change(' Ada '))
    await tick(399)
    h.rerender({ search: latest })
    expect(latest).not.toHaveBeenCalled()
    await tick(1)
    expect(latest.mock.calls).toHaveLength(1)
    expect(latest.mock.calls[0]?.[0]).toBe('Ada')
    act(() => h.result.current.find())
    await tick()
    expect(h.result.current.items).toEqual(reply('latest').items)
    h.rerender({ search: async () => reply('unused') })
    await tick(400)
    expect(h.result.current.items).toEqual(reply('latest').items)
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })

  it('deduplicates pending Enter, retries errors only explicitly and preserves dismissal', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof reply>>()
    const first = vi.fn(() => pending.promise)
    const latest = vi.fn<Search>(async () => reply('retried'))
    const h = mount(first)
    act(() => h.result.current.change('Ada'))
    act(() => h.result.current.find())
    act(() => h.result.current.find())
    await tick(400)
    expect(first).toHaveBeenCalledTimes(1)
    await act(async () => pending.reject(new Error('unavailable')))
    await tick()
    expect(h.result.current.error).toBe(true)
    expect(h.result.current.completed).toBe(false)
    h.rerender({ search: latest })
    await tick(400)
    expect(latest).not.toHaveBeenCalled()
    act(() => h.result.current.find())
    await tick()
    expect(latest).toHaveBeenCalledTimes(1)
    expect(h.result.current.items).toEqual(reply('retried').items)
    act(() => h.result.current.dismiss())
    expect(h.result.current.items).toEqual([])
    h.rerender({ search: async () => reply('reopened') })
    act(() => h.result.current.find())
    await tick(400)
    expect(h.result.current.items).toEqual([])
    expect(h.result.current.completed).toBe(false)
  })

  it('separates equal-term fields and A-B-A intents before GC, even when first A resolves last', async () => {
    const old = Promise.withResolvers<ReturnType<typeof reply>>()
    const fresh = Promise.withResolvers<ReturnType<typeof reply>>()
    const search = vi
      .fn<Search>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(reply('B'))
      .mockReturnValueOnce(fresh.promise)
    const client = new QueryClient()
    const a = mount(search, client)
    const b = mount(async () => reply('other-field'), client)
    act(() => {
      b.result.current.change('AA')
      a.result.current.change('AA')
    })
    act(() => {
      b.result.current.find()
      a.result.current.find()
    })
    await tick()
    expect(b.result.current.items).toEqual(reply('other-field').items)
    act(() => a.result.current.change('BB'))
    expect(a.result.current.items).toEqual([])
    act(() => a.result.current.find())
    await act(async () => {})
    act(() => a.result.current.change('AA'))
    expect(a.result.current.items).toEqual([])
    act(() => a.result.current.find())
    expect(search).toHaveBeenCalledTimes(3)
    await act(async () => fresh.resolve(reply('fresh-A')))
    await act(async () => old.resolve(reply('obsolete-A')))
    await tick()
    expect(a.result.current.items).toEqual(reply('fresh-A').items)
    expect(b.result.current.items).toEqual(reply('other-field').items)
    act(() => a.result.current.change('new'))
    expect(a.result.current.items).toEqual([])
  })

  it('aborts obsolete work and collects its entries without clearing another field', async () => {
    const old = Promise.withResolvers<ReturnType<typeof reply>>()
    const pending = Promise.withResolvers<ReturnType<typeof reply>>()
    const signals: AbortSignal[] = []
    const search: Search = (_term, signal) => {
      if (signal) signals.push(signal)
      return signals.length < 2 ? old.promise : pending.promise
    }
    const client = new QueryClient()
    const a = mount(search, client)
    const b = mount(async () => reply('retained'), client)
    act(() => {
      a.result.current.change('AA')
      b.result.current.change('AA')
    })
    act(() => {
      a.result.current.find()
      b.result.current.find()
    })
    await tick()
    act(() => a.result.current.change('BB'))
    expect(signals[0]?.aborted).toBe(true)
    act(() => a.result.current.find())
    a.unmount()
    expect(signals[1]?.aborted).toBe(true)
    await act(async () => {
      old.resolve(reply('old'))
      pending.resolve(reply('late'))
    })
    await tick()
    expect(b.result.current.items).toEqual(reply('retained').items)
    const entries = client.getQueryCache().getAll()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.state.data).toEqual(reply('retained'))
    b.unmount()
    await tick()
    expect(client.getQueryCache().getAll()).toHaveLength(0)
  })
})
