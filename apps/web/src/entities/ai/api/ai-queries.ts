import type { AiRunResponse, CreateAiConversationInput, CreateAiRunInput } from '@amcore/shared'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ClientErrorCode, ClientStateError } from '@/shared/api/error-codes'
import {
  captureQuerySession,
  isCurrentQuerySession,
  personalKey,
  type QueryOwner,
  sameQueryOwner,
} from '@/shared/api/query-session'

import { aiApi } from './ai-api'

export const aiKeys = {
  all: (owner: QueryOwner | null) => [...personalKey(owner), 'ai'] as const,
  conversation: (owner: QueryOwner | null, id: string | null) =>
    [...aiKeys.all(owner), 'conversation', id] as const,
  run: (owner: QueryOwner | null, id: string | null) => [...aiKeys.all(owner), 'run', id] as const,
  messages: (owner: QueryOwner | null, id: string | null) =>
    [...aiKeys.all(owner), 'messages', id] as const,
}

function requireOwner(client: ReturnType<typeof useQueryClient>, owner: QueryOwner | null) {
  const captured = captureQuerySession(client)
  if (!sameQueryOwner(owner, captured.owner))
    throw new ClientStateError(ClientErrorCode.AUTH_CONTINUATION_CHANGED)
  return captured
}

function requireResource(
  client: ReturnType<typeof useQueryClient>,
  owner: QueryOwner | null,
  id: string | null
): asserts id is string {
  requireOwner(client, owner)
  if (!id) throw new ClientStateError(ClientErrorCode.AUTH_CONTINUATION_CHANGED)
}

/** Refresh only the initiating run/transcript, without delaying command acknowledgment. */
export async function refreshAiRun(
  client: ReturnType<typeof useQueryClient>,
  captured: ReturnType<typeof captureQuerySession>,
  run: Pick<AiRunResponse, 'id' | 'conversationId'>
) {
  if (!isCurrentQuerySession(client, captured)) return
  const filters = [
    aiKeys.run(captured.owner, run.id),
    aiKeys.messages(captured.owner, run.conversationId),
  ].map((queryKey) => ({ queryKey, exact: true }))
  await Promise.all(filters.map((filter) => client.cancelQueries(filter)))
  if (isCurrentQuerySession(client, captured))
    filters.forEach((filter) => {
      void client.invalidateQueries(filter)
    })
}

export function useCreateAiConversation(owner: QueryOwner | null) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [...aiKeys.all(owner), 'create-conversation'],
    onMutate: () => requireOwner(client, owner),
    mutationFn: (input: CreateAiConversationInput) => {
      requireOwner(client, owner)
      return aiApi.createConversation(input)
    },
  })
}

export function useAiConversation(owner: QueryOwner | null, id: string | null) {
  const client = useQueryClient()
  return useQuery({
    queryKey: aiKeys.conversation(owner, id),
    enabled: !!owner && !!id,
    queryFn: ({ signal }) => {
      requireResource(client, owner, id)
      return aiApi.getConversation(id, signal)
    },
  })
}

export function useCreateAiRun(owner: QueryOwner | null) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [...aiKeys.all(owner), 'create-run'],
    onMutate: () => requireOwner(client, owner),
    mutationFn: (input: CreateAiRunInput) => {
      requireOwner(client, owner)
      return aiApi.createRun(input)
    },
    onSuccess: (run, _input, captured) => {
      void refreshAiRun(client, captured, run)
    },
  })
}

/** Durable run status; pair with useAiRunStream for content-free refresh hints. */
export function useAiRun(owner: QueryOwner | null, runId: string | null) {
  const client = useQueryClient()
  return useQuery({
    queryKey: aiKeys.run(owner, runId),
    enabled: !!owner && !!runId,
    queryFn: ({ signal }) => {
      requireResource(client, owner, runId)
      return aiApi.getRun(runId, signal)
    },
  })
}

export function useCancelAiRun(owner: QueryOwner | null) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [...aiKeys.all(owner), 'cancel-run'],
    onMutate: () => requireOwner(client, owner),
    mutationFn: (run: Pick<AiRunResponse, 'id' | 'conversationId'>) => {
      requireOwner(client, owner)
      return aiApi.cancelRun(run.id)
    },
    onSuccess: (_result, run, captured) => {
      void refreshAiRun(client, captured, run)
    },
  })
}

/** Keyset transcript, oldest first; the cursor is a numeric sequence, not a feed token. */
export function useAiMessages(owner: QueryOwner | null, conversationId: string | null) {
  const client = useQueryClient()
  return useInfiniteQuery({
    queryKey: aiKeys.messages(owner, conversationId),
    enabled: !!owner && !!conversationId,
    queryFn: ({ pageParam, signal }) => {
      requireResource(client, owner, conversationId)
      return aiApi.getMessages(conversationId, pageParam, signal)
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.nextCursor !== null ? Number(lastPage.nextCursor) : undefined,
  })
}
