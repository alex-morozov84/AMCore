import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useEventSource } from '@/shared/api/sse/use-event-source'

import { aiKeys } from './ai-queries'
import { useAiRunStream } from './use-ai-run-stream'

vi.mock('@/shared/api/sse/use-event-source', () => ({ useEventSource: vi.fn() }))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, Wrapper }
}

describe('useAiRunStream', () => {
  it('connects to the relative same-origin BFF run stream route for the given run', () => {
    const { Wrapper } = createWrapper()

    renderHook(() => useAiRunStream('run-1'), { wrapper: Wrapper })

    expect(vi.mocked(useEventSource)).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/ai/runs/run-1/stream', enabled: true })
    )
  })

  it('invalidates only that run on open and on every status hint', () => {
    const { queryClient, Wrapper } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderHook(() => useAiRunStream('run-1'), { wrapper: Wrapper })

    const options = vi.mocked(useEventSource).mock.calls[0]![0]
    options.onOpen?.()
    options.onEvent({ eventId: 'e1', runId: 'run-1', status: 'running', reason: 'status_changed' })

    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: aiKeys.run('run-1') })
  })
})
