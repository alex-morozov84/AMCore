'use client'

import { type AiRunResponse, aiRunSseEventSchema } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { captureQuerySession, type QueryOwner, sameQueryOwner } from '@/shared/api/query-session'
import { useEventSource } from '@/shared/api/sse/use-event-source'

import { refreshAiRun } from './ai-queries'

import 'client-only'

/** Hints refresh the captured run and transcript; HTTP remains authoritative. */
export function useAiRunStream(
  owner: QueryOwner | null,
  run: Pick<AiRunResponse, 'id' | 'conversationId'> | null,
  enabled = true
): void {
  const client = useQueryClient()
  const captured = captureQuerySession(client)
  const admitted = sameQueryOwner(owner, captured.owner)
  const refresh = () => {
    if (admitted && run) void refreshAiRun(client, captured, run)
  }
  useEventSource({
    url: run ? `/api/ai/runs/${encodeURIComponent(run.id)}/stream` : null,
    schema: aiRunSseEventSchema,
    enabled: enabled && admitted && !!run,
    connectionKey: JSON.stringify([
      owner?.contextSession,
      owner?.userId,
      run?.id,
      run?.conversationId,
    ]),
    onOpen: refresh,
    onEvent: (event) => {
      if (event.runId === run?.id) refresh()
    },
  })
}
