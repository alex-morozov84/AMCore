import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { aiApi } from './ai-api'
import { aiKeys, useAiMessages, useAiRun, useCreateAiRun } from './ai-queries'

vi.mock('./ai-api', () => ({
  aiApi: { createRun: vi.fn(), getRun: vi.fn(), getMessages: vi.fn() },
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, Wrapper }
}

const run = {
  id: 'run-1',
  conversationId: 'conv-1',
  status: 'queued' as const,
  errorCode: null,
  terminalReasonCode: null,
  pendingApprovalId: null,
  createdAt: '2026-08-13T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
}

describe('useCreateAiRun', () => {
  it('seeds the run cache with the created run so useAiRun(id) can render it without a refetch', async () => {
    vi.mocked(aiApi.createRun).mockResolvedValue(run)
    const { queryClient, Wrapper } = createWrapper()

    const { result } = renderHook(() => useCreateAiRun(), { wrapper: Wrapper })
    result.current.mutate({ conversationId: 'conv-1', inputParts: [{ type: 'text', text: 'hi' }] })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(queryClient.getQueryData(aiKeys.run('run-1'))).toEqual(run)
  })
})

describe('useAiRun', () => {
  it('fetches the run by id', async () => {
    vi.mocked(aiApi.getRun).mockResolvedValue(run)

    const { result } = renderHook(() => useAiRun('run-1'), { wrapper: createWrapper().Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(aiApi.getRun).toHaveBeenCalledWith('run-1')
    expect(result.current.data).toEqual(run)
  })
})

describe('useAiMessages', () => {
  it('paginates the transcript by numeric sequence cursor, not the opaque feed-cursor string', async () => {
    vi.mocked(aiApi.getMessages).mockResolvedValue({ data: [], nextCursor: '5', hasMore: true })

    const { result } = renderHook(() => useAiMessages('conv-1'), {
      wrapper: createWrapper().Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    await result.current.fetchNextPage()

    expect(aiApi.getMessages).toHaveBeenLastCalledWith('conv-1', 5)
  })
})
