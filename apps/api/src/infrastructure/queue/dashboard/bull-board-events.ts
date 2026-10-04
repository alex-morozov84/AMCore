/**
 * Content-free operational events of the queue board (no payloads, tokens, queue names or job ids).
 * `credential` is how the request authenticated; `actorId` only for the bearer path.
 */
export type BoardEvent =
  | {
      readonly event: 'bull_board.entry_opened'
      readonly credential: 'cookie' | 'bearer'
      readonly actorId?: string
    }
  | {
      readonly event: 'bull_board.access_denied'
      readonly reason:
        'unauthenticated' | 'forbidden' | 'api_key' | 'invalid_context' | 'unavailable'
    }
  | { readonly event: 'bull_board.entry_render_failed' }

export type BoardEventSink = (event: BoardEvent) => void

export const NOOP_BOARD_EVENTS: BoardEventSink = () => undefined
