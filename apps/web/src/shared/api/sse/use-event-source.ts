'use client'

import { useEffect, useRef } from 'react'
import type { ZodType } from 'zod'

import 'client-only'

interface UseEventSourceOptions<T> {
  /** Relative, same-origin BFF URL (e.g. `/api/notifications/stream`). `null` skips connecting. */
  url: string | null
  /** Validates each `message` frame; an unparseable frame is dropped, never trusted as state. */
  schema: ZodType<T>
  /**
   * Fires once the connection is open — the place to do the initial invalidate/refetch. Connect
   * the stream, then refetch, never the reverse, or an event fired between the initial fetch and
   * the subscribe is silently missed.
   */
  onOpen?: () => void
  /**
   * Fires for each successfully-parsed event. Treat this as "something changed, refetch" — never
   * as the new state itself. The durable resource (fetched separately) stays the source of truth.
   */
  onEvent: (data: T) => void
  enabled?: boolean
}

/**
 * Rejects anything that isn't a same-origin, relative `/api/...` path — an absolute URL
 * (`https://api.example.com/...`) or a protocol-relative one (`//api.example.com/...`) would
 * bypass the BFF proxy entirely and connect straight to `apps/api`, where `EventSource` cannot
 * set the `Authorization` header the stream requires. Enforced at runtime, not just documented,
 * so a future caller that accidentally points at the backend fails loudly instead of silently
 * shipping a broken (or credential-leaking) connection.
 */
function assertSafeBffUrl(url: string): void {
  if (!url.startsWith('/api/')) {
    throw new Error(
      `useEventSource: url must be a relative BFF path starting with "/api/" (got "${url}"). ` +
        'An absolute or protocol-relative URL would bypass the BFF and connect straight to apps/api.'
    )
  }
}

/**
 * Shared BFF-only SSE consumption primitive (ai/models-talk.md, Track 6 slice 8). Native
 * `EventSource` is safe here specifically because the browser never holds a bearer token: the
 * Next.js Route Handler proxy (`authenticated-proxy.ts`) attaches it server-side from the
 * `amcore_session` cookie, which `EventSource` sends automatically via `withCredentials`. A
 * **direct** (non-BFF) SSE consumer still needs a custom fetch-stream reader, since `EventSource`
 * cannot set an `Authorization` header — see `docs/notifications/README.md` / `docs/ai/runs.md`,
 * which describe that direct case and are correct as written for it.
 */
export function useEventSource<T>({
  url,
  schema,
  onOpen,
  onEvent,
  enabled = true,
}: UseEventSourceOptions<T>): void {
  const onOpenRef = useRef(onOpen)
  const onEventRef = useRef(onEvent)
  const schemaRef = useRef(schema)
  onOpenRef.current = onOpen
  onEventRef.current = onEvent
  schemaRef.current = schema

  useEffect(() => {
    if (!enabled || !url) return
    assertSafeBffUrl(url)

    const source = new EventSource(url, { withCredentials: true })

    source.onopen = () => onOpenRef.current?.()

    source.onmessage = (event: MessageEvent<string>) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(event.data)
      } catch {
        return
      }
      const result = schemaRef.current.safeParse(parsed)
      if (!result.success) {
        console.error('useEventSource: dropped an unparseable frame', result.error)
        return
      }
      onEventRef.current(result.data)
    }

    return () => source.close()
  }, [url, enabled])
}
