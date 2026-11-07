import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

// eslint-disable-next-line boundaries/dependencies -- Integration fixture uses the subscribed bootstrap for AI stream retirement.
import { useCurrentUser } from '@/entities/user'
import {
  currentUserKey,
  publishCurrentUser,
  queryOwner,
  type UserEnvelope,
} from '@/shared/api/query-session'

import { aiKeys, useAiMessages, useAiRun } from './ai-queries'
import { useAiRunStream } from './use-ai-run-stream'

class Source {
  static instances: Source[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  closed = false
  constructor(public url: string) {
    Source.instances.push(this)
  }
  close() {
    this.closed = true
  }
}
const owner = { userId: 'a', contextSession: 's1' }
const pair = { id: 'r1', conversationId: 'c1' }
const frame = (runId = pair.id) =>
  ({
    data: JSON.stringify({ eventId: 'e', runId, status: 'completed', reason: 'status_changed' }),
  }) as MessageEvent<string>
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Source.instances = []
})
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(currentUserKey, {
    user: { id: owner.userId },
    contextSession: owner.contextSession,
  })
  const pending: {
    url: string
    method: string
    signal?: AbortSignal | null
    done: ReturnType<typeof Promise.withResolvers<Response>>
  }[] = []
  vi.stubGlobal('EventSource', Source)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const done = Promise.withResolvers<Response>()
      pending.push({ url, method: init.method!, signal: init.signal, done })
      return done.promise
    })
  )
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, pending, wrapper }
}
it.each(['open', 'message'])(
  'replaces first pending run and transcript GETs on %s',
  async (kind) => {
    const { client, pending, wrapper } = setup()
    const { result, unmount } = renderHook(
      () => {
        useAiRunStream(owner, pair)
        return {
          run: { ...useAiRun(owner, pair.id) },
          messages: { ...useAiMessages(owner, pair.conversationId) },
        }
      },
      { wrapper }
    )
    await waitFor(() => expect(pending).toHaveLength(2))
    const source = Source.instances[0]!
    act(() => source.onmessage?.(frame('wrong')))
    expect(pending).toHaveLength(2)
    act(() => (kind === 'open' ? source.onopen?.() : source.onmessage?.(frame())))
    await waitFor(() => expect(pending).toHaveLength(4))
    expect(pending.slice(0, 2).every((p) => p.signal?.aborted)).toBe(true)
    await act(async () => {
      pending[2]!.done.resolve(Response.json({ ...pair, status: 'completed' }))
      pending[3]!.done.resolve(
        Response.json({ data: [{ sequence: 1 }], hasMore: false, nextCursor: null })
      )
    })
    await waitFor(() => expect(result.current.messages.data?.pages[0]?.data[0]?.sequence).toBe(1))
    await act(async () => {
      pending[0]!.done.resolve(Response.json({ ...pair, status: 'running' }))
      pending[1]!.done.resolve(Response.json({ data: [], hasMore: false, nextCursor: null }))
    })
    expect(result.current.run.data?.status).toBe('completed')
    expect(result.current.messages.data?.pages[0]?.data[0]?.sequence).toBe(1)
    expect(client.getQueryState(aiKeys.messages(owner, pair.conversationId))?.isInvalidated).toBe(
      false
    )
    unmount()
  }
)
it('refreshes an already mounted transcript after a completion hint', async () => {
  const { client, pending, wrapper } = setup()
  client.setQueryData(aiKeys.messages(owner, pair.conversationId), {
    pages: [{ data: [], hasMore: false, nextCursor: null }],
    pageParams: [undefined],
  })
  client.setQueryDefaults(aiKeys.messages(owner, pair.conversationId), { staleTime: Infinity })
  const { result, unmount } = renderHook(
    () => {
      useAiRunStream(owner, pair)
      return { ...useAiMessages(owner, pair.conversationId) }
    },
    { wrapper }
  )
  act(() => Source.instances[0]!.onmessage?.(frame()))
  await waitFor(() => expect(pending).toHaveLength(1))
  expect(pending[0]!.url).toContain('/messages')
  await act(async () =>
    pending[0]!.done.resolve(
      Response.json({
        data: [{ role: 'ASSISTANT', sequence: 1 }],
        hasMore: false,
        nextCursor: null,
      })
    )
  )
  await waitFor(() => expect(result.current.data?.pages[0]?.data[0]?.role).toBe('ASSISTANT'))
  expect(client.getQueryState(aiKeys.run(owner, pair.id))).toBeUndefined()
  unmount()
})

it.each(['other-user', 'same-user'])(
  'retires stream continuations on %s replacement and tracks selected pairs',
  async (kind) => {
    const { client, wrapper } = setup()
    const { rerender, unmount } = renderHook(
      ({ selected }) => {
        const active = queryOwner(useCurrentUser().data)
        useAiRun(active, selected?.id ?? null)
        useAiRunStream(active, selected ? { ...selected } : null)
      },
      { wrapper, initialProps: { selected: pair as typeof pair | null } }
    )
    const old = Source.instances[0]!
    expect(old.url).toBe('/api/ai/runs/r1/stream')
    rerender({ selected: { ...pair } })
    expect(Source.instances).toHaveLength(1)
    const oldOpen = old.onopen!,
      oldMessage = old.onmessage!
    const gate = Promise.withResolvers<void>(),
      cancelled = Promise.withResolvers<void>()
    const cancel = client.cancelQueries.bind(client)
    vi.spyOn(client, 'cancelQueries').mockImplementationOnce(async (...args) => {
      await cancel(...args)
      cancelled.resolve()
      await gate.promise
    })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    act(() => oldOpen())
    await cancelled.promise
    const next = {
      user: { id: kind === 'other-user' ? 'b' : 'a' },
      contextSession: 's2',
    } as UserEnvelope
    await act(async () => {
      await publishCurrentUser(client, next)
    })
    await waitFor(() => expect(Source.instances).toHaveLength(2))
    expect(old.closed).toBe(true)
    await act(async () => {
      gate.resolve()
      oldOpen()
      oldMessage(frame())
    })
    expect(invalidate).not.toHaveBeenCalled()
    expect(client.getQueriesData({ queryKey: aiKeys.all(owner) })).toEqual([])
    const second = Source.instances[1]!,
      secondOpen = second.onopen!
    rerender({ selected: { id: 'r2', conversationId: 'c2' } })
    expect(second.closed).toBe(true)
    secondOpen()
    expect(invalidate).not.toHaveBeenCalled()
    const third = Source.instances[2]!
    act(() => third.onopen?.())
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: aiKeys.messages(queryOwner(next), 'c2'),
        exact: true,
      })
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: aiKeys.run(queryOwner(next), 'r2'),
      exact: true,
    })
    rerender({ selected: null })
    expect(third.closed).toBe(true)
    expect(Source.instances).toHaveLength(3)
    rerender({ selected: pair })
    const last = Source.instances[3]!
    await act(async () => {
      await publishCurrentUser(client, { user: null })
    })
    await waitFor(() => expect(last.closed).toBe(true))
    expect(Source.instances).toHaveLength(4)
    unmount()
  }
)
