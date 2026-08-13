import type { CreateAiConversationInput, CreateAiRunInput } from '@amcore/shared'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { aiApi } from './ai-api'

export const aiKeys = {
  all: ['ai'] as const,
  conversation: (id: string) => [...aiKeys.all, 'conversation', id] as const,
  run: (id: string) => [...aiKeys.all, 'run', id] as const,
  messages: (conversationId: string) => [...aiKeys.all, 'messages', conversationId] as const,
}

export function useCreateAiConversation() {
  return useMutation({
    mutationFn: (input: CreateAiConversationInput) => aiApi.createConversation(input),
  })
}

export function useAiConversation(id: string) {
  return useQuery({
    queryKey: aiKeys.conversation(id),
    queryFn: () => aiApi.getConversation(id),
  })
}

export function useCreateAiRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAiRunInput) => aiApi.createRun(input),
    // Seeds the run cache immediately so a caller can render/poll `useAiRun(run.id)`
    // right after creation without an extra round trip.
    onSuccess: (run) => queryClient.setQueryData(aiKeys.run(run.id), run),
  })
}

/**
 * Fetches the durable run status. Pair with `useAiRunStream` — the SSE hint says
 * "refetch," this hook is what actually holds the authoritative state.
 */
export function useAiRun(runId: string) {
  return useQuery({
    queryKey: aiKeys.run(runId),
    queryFn: () => aiApi.getRun(runId),
  })
}

export function useCancelAiRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) => aiApi.cancelRun(runId),
    onSuccess: (result) => queryClient.invalidateQueries({ queryKey: aiKeys.run(result.id) }),
  })
}

/** Keyset transcript, oldest first (`sequence` ascending) — not a cursor-token string like the
 * notification feed, a plain integer offset into the conversation's monotonic sequence. */
export function useAiMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: aiKeys.messages(conversationId),
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      aiApi.getMessages(conversationId, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.nextCursor !== null ? Number(lastPage.nextCursor) : undefined,
  })
}
