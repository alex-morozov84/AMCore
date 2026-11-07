import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// eslint-disable-next-line boundaries/dependencies -- Integration fixture uses the public bootstrap to verify AI owner changes.
import { useCurrentUser } from '@/entities/user'
import {
  currentUserKey,
  publishCurrentUser,
  type QueryOwner,
  queryOwner,
  type UserEnvelope,
} from '@/shared/api/query-session'

import { aiApi } from './ai-api'
import {
  aiKeys,
  useAiConversation,
  useAiMessages,
  useAiRun,
  useCancelAiRun,
  useCreateAiConversation,
  useCreateAiRun,
} from './ai-queries'

const owner = { userId: 'a', contextSession: 's1' }
const envelope = (value: QueryOwner | null) =>
  ({
    user: value ? { id: value.userId } : null,
    contextSession: value?.contextSession,
  }) as UserEnvelope
afterEach(() => {
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(currentUserKey, envelope(owner))
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, Wrapper }
}

const run = {
  id: 'run-1',
  conversationId: 'conv-1',
  retryOfRunId: null,
  retriedByRunId: null,
  operatorRetry: false,
  status: 'queued' as const,
  errorCode: null,
  terminalReasonCode: null,
  pendingApprovalId: null,
  createdAt: '2026-08-13T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
}

describe('useCreateAiRun', () => {
  it('returns creation success independently of a delayed, failed and retried read', async () => {
    vi.spyOn(aiApi, 'createRun').mockResolvedValue(run)
    const { queryClient, Wrapper } = createWrapper()

    const { result } = renderHook(() => useCreateAiRun(owner), { wrapper: Wrapper })
    result.current.mutate({ conversationId: 'conv-1', inputParts: [{ type: 'text', text: 'hi' }] })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(run)
    expect(queryClient.getQueryData(aiKeys.run(owner, run.id))).toBeUndefined()
    const held = Promise.withResolvers<typeof run>()
    vi.spyOn(aiApi, 'getRun').mockReturnValueOnce(held.promise)
    const reader = renderHook(() => useAiRun(owner, run.id), { wrapper: Wrapper })
    await waitFor(() => expect(aiApi.getRun).toHaveBeenCalledOnce())
    expect(reader.result.current.isPending).toBe(true)
    await act(async () => held.reject(new Error('read failed')))
    await waitFor(() => expect(reader.result.current.isError).toBe(true))
    expect(result.current.isSuccess).toBe(true)
    vi.spyOn(aiApi, 'getRun').mockResolvedValueOnce(run)
    await act(async () => {
      await reader.result.current.refetch()
    })
    await waitFor(() => expect(reader.result.current.data).toEqual(run))
    expect(aiApi.createRun).toHaveBeenCalledOnce()
  })

  it('does not republish an old run after cache retirement and observer unmount', async () => {
    const held = Promise.withResolvers<typeof run>()
    vi.spyOn(aiApi, 'createRun').mockReturnValueOnce(held.promise)
    const { queryClient, Wrapper } = createWrapper()
    const hook = renderHook(() => useCreateAiRun(owner), { wrapper: Wrapper })
    let pending!: Promise<unknown>
    act(() => {
      pending = hook.result.current.mutateAsync({
        conversationId: 'conv-1',
        inputParts: [{ type: 'text', text: 'hi' }],
      })
    })
    await waitFor(() => expect(aiApi.createRun).toHaveBeenCalledOnce())
    act(() => queryClient.clear())
    hook.unmount()
    await act(async () => {
      held.resolve(run)
      await pending
    })
    expect(queryClient.getQueryData(aiKeys.run(owner, run.id))).toBeUndefined()
  })
})

describe('useAiRun', () => {
  it('fetches the run by id', async () => {
    vi.spyOn(aiApi, 'getRun').mockResolvedValue(run)

    const { result } = renderHook(() => useAiRun(owner, 'run-1'), {
      wrapper: createWrapper().Wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(aiApi.getRun).toHaveBeenCalledWith('run-1', expect.any(AbortSignal))
    expect(result.current.data).toEqual(run)
  })
})

describe('useAiMessages', () => {
  it('paginates the transcript by numeric sequence cursor, not the opaque feed-cursor string', async () => {
    vi.spyOn(aiApi, 'getMessages').mockResolvedValue({ data: [], nextCursor: '5', hasMore: true })

    const { result } = renderHook(() => useAiMessages(owner, 'conv-1'), {
      wrapper: createWrapper().Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    await result.current.fetchNextPage()

    expect(aiApi.getMessages).toHaveBeenLastCalledWith('conv-1', 5, expect.any(AbortSignal))
  })
})

function transport() {
  const pending: {
    url: string
    method: string
    body?: BodyInit | null
    signal?: AbortSignal | null
    done: ReturnType<typeof Promise.withResolvers<Response>>
  }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const done = Promise.withResolvers<Response>()
      pending.push({ url, method: init.method!, body: init.body, signal: init.signal, done })
      return done.promise
    })
  )
  return pending
}
const page = (sequences: number[], hasMore = false) => ({
  data: sequences.map((sequence) => ({ sequence })),
  hasMore,
  nextCursor: hasMore ? String(sequences.at(-1)) : null,
})
const actions = [
  ['conversation', useCreateAiConversation, { title: 'test' }],
  [
    'create',
    useCreateAiRun,
    { conversationId: run.conversationId, inputParts: [{ type: 'text', text: 'hi' }] },
  ],
  ['cancel', useCancelAiRun, run],
] as const

it.each(['other-user', 'same-user'])(
  'retires mounted reads and pending pages on %s replacement',
  async (kind) => {
    const { queryClient: client, Wrapper } = createWrapper()
    const pending = transport()
    const next = { userId: kind === 'other-user' ? 'b' : 'a', contextSession: 's2' }
    const { result, unmount } = renderHook(
      () => {
        const active = queryOwner(useCurrentUser().data)
        return {
          conversation: { ...useAiConversation(active, run.conversationId) },
          run: { ...useAiRun(active, run.id) },
          messages: { ...useAiMessages(active, run.conversationId) },
        }
      },
      { wrapper: Wrapper }
    )
    await waitFor(() => expect(pending).toHaveLength(3))
    await act(async () => pending[2]!.done.resolve(Response.json(page([0], true))))
    await waitFor(() => expect(result.current.messages.hasNextPage).toBe(true))
    act(() => {
      void result.current.messages.fetchNextPage()
    })
    await waitFor(() => expect(pending).toHaveLength(4))
    expect(pending[3]!.url).toContain('cursor=0')
    await act(async () => {
      await publishCurrentUser(client, envelope(next))
    })
    await waitFor(() => expect(pending).toHaveLength(7))
    expect([0, 1, 3].every((i) => pending[i]!.signal?.aborted)).toBe(true)
    expect(result.current.conversation.data).toBeUndefined()
    expect(result.current.run.data).toBeUndefined()
    expect(result.current.messages.data).toBeUndefined()
    await act(async () => {
      pending[4]!.done.resolve(Response.json({ id: 'new' }))
      pending[5]!.done.resolve(Response.json({ ...run, status: 'completed' }))
      pending[6]!.done.resolve(Response.json(page([2])))
      pending[0]!.done.resolve(Response.json({ id: 'old' }))
      pending[1]!.done.resolve(Response.json(run))
      pending[3]!.done.resolve(Response.json(page([1])))
    })
    await waitFor(() => expect(result.current.messages.data?.pages[0]?.data[0]?.sequence).toBe(2))
    expect(result.current.run.data?.status).toBe('completed')
    expect(result.current.conversation.data?.id).toBe('new')
    expect(client.getQueriesData({ queryKey: aiKeys.all(owner) })).toEqual([])
    await act(async () => {
      await publishCurrentUser(client, envelope(null))
    })
    await waitFor(() => expect(result.current.run.data).toBeUndefined())
    await act(async () => {
      await result.current.conversation.refetch()
      await result.current.run.refetch()
      await result.current.messages.fetchNextPage()
    })
    expect(pending).toHaveLength(7)
    await act(async () => {
      await publishCurrentUser(client, envelope(owner))
    })
    await waitFor(() => expect(pending).toHaveLength(10))
    expect(result.current.messages.data).toBeUndefined()
    unmount()
  }
)

it('rejects forced reads without resource IDs even with a confirmed owner', async () => {
  const { Wrapper } = createWrapper()
  const pending = transport()
  const { result } = renderHook(
    () => ({
      conversation: useAiConversation(owner, null),
      run: useAiRun(owner, null),
      messages: useAiMessages(owner, null),
    }),
    { wrapper: Wrapper }
  )
  await act(async () => {
    await result.current.conversation.refetch()
    await result.current.run.refetch()
    await result.current.messages.fetchNextPage()
  })
  expect(pending).toHaveLength(0)
})

it.each(
  actions.flatMap((action) => ['other-user', 'same-user'].map((kind) => [...action, kind] as const))
)(
  '%s retains paused admission and dispatched completion across %s',
  async (_name, useAction, input, kind) => {
    const { queryClient: client, Wrapper } = createWrapper()
    const pending = transport()
    const { result, unmount } = renderHook(
      () => ({ ...useAction(queryOwner(useCurrentUser().data)) }),
      { wrapper: Wrapper }
    )
    onlineManager.setOnline(false)
    act(() => result.current.mutate(input as never))
    await waitFor(() => expect(result.current.isPaused).toBe(true))
    const paused = client.getMutationCache().getAll()[0]!
    const next = { userId: kind === 'other-user' ? 'b' : 'a', contextSession: 's2' }
    await act(async () => {
      await publishCurrentUser(client, envelope(next))
    })
    await waitFor(() => expect(result.current.isIdle).toBe(true))
    await act(async () => {
      onlineManager.setOnline(true)
      await client.resumePausedMutations()
    })
    expect(paused.state.status).toBe('error')
    expect(pending).toHaveLength(0)
    act(() => result.current.mutate(input as never))
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => {
      await publishCurrentUser(client, envelope(owner))
    })
    const key = aiKeys.messages(owner, run.conversationId)
    client.setQueryData(key, { pages: [page([7])], pageParams: [undefined] })
    await act(async () => pending[0]!.done.resolve(Response.json(run)))
    await waitFor(() =>
      expect(client.getMutationCache().getAll().at(-1)!.state.status).toBe('success')
    )
    expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    expect(client.getQueriesData({ queryKey: aiKeys.all(next) })).toEqual([])
    expect(client.getQueryState(aiKeys.run(owner, run.id))).toBeUndefined()
    await act(async () => {
      await publishCurrentUser(client, envelope(null))
    })
    await waitFor(() => expect(result.current.isIdle).toBe(true))
    act(() => result.current.mutate(input as never))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(pending).toHaveLength(1)
    unmount()
  }
)

it.each(actions.slice(1))(
  '%s refreshes its original pair without awaiting GET or adopting new selection',
  async (name, useAction, input) => {
    const { queryClient: client, Wrapper } = createWrapper()
    const pending = transport()
    const other = { id: 'r2', conversationId: 'c2' }
    const untouched = [
      aiKeys.run(owner, other.id),
      aiKeys.messages(owner, other.conversationId),
      aiKeys.conversation(owner, run.conversationId),
      aiKeys.messages({ ...owner, contextSession: 's2' }, run.conversationId),
      ['personal', 's1', 'a', 'notifications'],
    ]
    untouched.forEach((key) => client.setQueryData(key, {}))
    client.setQueryData(aiKeys.run(owner, run.id), run)
    client.setQueryDefaults(aiKeys.all(owner), { staleTime: Infinity })
    const { result, rerender, unmount } = renderHook(
      ({ selected }) => ({
        selected,
        write: { ...useAction(owner) },
        messages: { ...useAiMessages(owner, run.conversationId) },
      }),
      {
        wrapper: Wrapper,
        initialProps: { selected: run as Pick<typeof run, 'id' | 'conversationId'> },
      }
    )
    await waitFor(() => expect(pending).toHaveLength(1))
    act(() => result.current.write.mutate(input as never))
    await waitFor(() => expect(pending).toHaveLength(2))
    rerender({ selected: other })
    expect(result.current.selected).toEqual(other)
    const receipt =
      name === 'cancel' ? { id: run.id, status: 'running', cancellationRequested: true } : run
    await act(async () => pending[1]!.done.resolve(Response.json(receipt)))
    await waitFor(() => expect(pending).toHaveLength(3))
    await waitFor(() => expect(result.current.write.isSuccess).toBe(true))
    expect(result.current.write.data).toEqual(receipt)
    expect(pending[0]!.signal?.aborted).toBe(true)
    expect(client.getQueryState(aiKeys.run(owner, run.id))?.isInvalidated).toBe(true)
    untouched.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(false))
    expect(pending[1]!.url).toBe(name === 'cancel' ? '/api/ai/runs/run-1/cancel' : '/api/ai/runs')
    if (name === 'create')
      expect(JSON.parse(pending[1]!.body as string).conversationId).toBe(run.conversationId)
    await act(async () => {
      pending[2]!.done.resolve(Response.json({}, { status: 503 }))
      pending[0]!.done.resolve(Response.json(page([99])))
    })
    await waitFor(() => expect(result.current.messages.isError).toBe(true))
    expect(result.current.write.isSuccess).toBe(true)
    act(() => {
      void result.current.messages.refetch()
    })
    await waitFor(() => expect(pending).toHaveLength(4))
    await act(async () => pending[3]!.done.resolve(Response.json(page([0]))))
    await waitFor(() => expect(result.current.messages.data?.pages[0]?.data[0]?.sequence).toBe(0))
    expect(pending.filter((p) => p.method === 'POST')).toHaveLength(1)
    unmount()
  }
)

it('refreshes two loaded transcript pages and exposes a newly appended page', async () => {
  const { Wrapper } = createWrapper()
  const pending = transport()
  const { result, unmount } = renderHook(
    () => ({
      messages: { ...useAiMessages(owner, run.conversationId) },
      create: useCreateAiRun(owner),
    }),
    { wrapper: Wrapper }
  )
  const finish = (i: number, body: unknown) =>
    act(async () => pending[i]!.done.resolve(Response.json(body)))
  const sequences = () =>
    result.current.messages.data?.pages.flatMap((p) => p.data.map((m) => m.sequence))
  await waitFor(() => expect(pending).toHaveLength(1))
  await finish(0, page([0, 1], true))
  await waitFor(() => expect(result.current.messages.hasNextPage).toBe(true))
  act(() => {
    void result.current.messages.fetchNextPage()
  })
  await waitFor(() => expect(pending).toHaveLength(2))
  expect(pending[1]!.url).toContain('cursor=1')
  await finish(1, page([2]))
  await waitFor(() => expect(sequences()).toEqual([0, 1, 2]))
  expect(result.current.messages.data?.pageParams).toEqual([undefined, 1])
  act(() =>
    result.current.create.mutate({
      conversationId: run.conversationId,
      inputParts: [{ type: 'text', text: 'new' }],
    })
  )
  await waitFor(() => expect(pending).toHaveLength(3))
  await finish(2, run)
  await waitFor(() => expect(pending).toHaveLength(4))
  await finish(3, page([0, 1], true))
  await waitFor(() => expect(pending).toHaveLength(5))
  expect(pending[4]!.url).toContain('cursor=1')
  await finish(4, page([2, 3]))
  await waitFor(() => expect(sequences()).toEqual([0, 1, 2, 3]))
  expect(result.current.messages.data?.pageParams).toEqual([undefined, 1])
  act(() => {
    void result.current.messages.refetch()
  })
  await waitFor(() => expect(pending).toHaveLength(6))
  await finish(5, page([0, 1], true))
  await waitFor(() => expect(pending).toHaveLength(7))
  await finish(6, page([2, 3], true))
  await waitFor(() => expect(result.current.messages.hasNextPage).toBe(true))
  expect(sequences()).toEqual([0, 1, 2, 3])
  expect(result.current.messages.data?.pageParams).toEqual([undefined, 1])
  act(() => {
    void result.current.messages.fetchNextPage()
  })
  await waitFor(() => expect(pending).toHaveLength(8))
  expect(pending[7]!.url).toContain('cursor=3')
  await finish(7, page([4]))
  await waitFor(() => expect(sequences()).toEqual([0, 1, 2, 3, 4]))
  expect(result.current.messages.data?.pageParams).toEqual([undefined, 1, 3])
  expect(result.current.messages.hasNextPage).toBe(false)
  expect(pending.filter((p) => p.method === 'POST')).toHaveLength(1)
  unmount()
})
