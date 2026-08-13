'use client'

import { aiRunSseEventSchema } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { useEventSource } from '@/shared/api/sse/use-event-source'

import { aiKeys } from './ai-queries'

import 'client-only'

/**
 * Realtime run-status stream (ADR-053 pattern). `status_changed` is the only
 * reason today — a content-free hint, never the status itself — so this
 * just refetches the run; `useAiRun(runId)` stays the source of truth.
 */
export function useAiRunStream(runId: string, enabled = true): void {
  const queryClient = useQueryClient()

  const invalidate = () => queryClient.invalidateQueries({ queryKey: aiKeys.run(runId) })

  useEventSource({
    url: `/api/ai/runs/${encodeURIComponent(runId)}/stream`,
    schema: aiRunSseEventSchema,
    enabled,
    onOpen: invalidate,
    onEvent: invalidate,
  })
}
