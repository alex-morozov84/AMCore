import type {
  AiConversationResponse,
  AiRunCancelResponse,
  AiRunResponse,
  AiTranscriptResponse,
  CreateAiConversationInput,
  CreateAiRunInput,
} from '@amcore/shared'

import { apiClient } from '@/shared/api'

/**
 * All calls go through the generic same-origin BFF proxy (ADR-068) — no
 * dedicated Route Handler needed, bearer-only throughout.
 */
export const aiApi = {
  createConversation: (input: CreateAiConversationInput): Promise<AiConversationResponse> =>
    apiClient.post<AiConversationResponse>('/ai/conversations', input),

  getConversation: (id: string, signal?: AbortSignal): Promise<AiConversationResponse> =>
    apiClient.get<AiConversationResponse>(`/ai/conversations/${encodeURIComponent(id)}`, {
      signal,
    }),

  createRun: (input: CreateAiRunInput): Promise<AiRunResponse> =>
    apiClient.post<AiRunResponse>('/ai/runs', input),

  getRun: (id: string, signal?: AbortSignal): Promise<AiRunResponse> =>
    apiClient.get<AiRunResponse>(`/ai/runs/${encodeURIComponent(id)}`, { signal }),

  cancelRun: (id: string): Promise<AiRunCancelResponse> =>
    apiClient.post<AiRunCancelResponse>(`/ai/runs/${encodeURIComponent(id)}/cancel`),

  // Keyset by `sequence` (oldest first) — the `id`/`GET .../messages` route lives on the
  // conversation-control controller (takeover surface), not the conversations one, even
  // though the path reads like it belongs there.
  getMessages: (
    conversationId: string,
    cursor?: number,
    signal?: AbortSignal
  ): Promise<AiTranscriptResponse> => {
    const params = new URLSearchParams()
    if (cursor !== undefined) params.set('cursor', String(cursor))
    const query = params.toString()
    return apiClient.get<AiTranscriptResponse>(
      `/ai/conversations/${encodeURIComponent(conversationId)}/messages${query ? `?${query}` : ''}`,
      { signal }
    )
  },
}
