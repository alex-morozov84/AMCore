import { isBullBoardEnabled } from './bull-board-mount-gate'

/** Why the Board is (not) mounted: a closed set, never derived from a later env read or an HTTP 404. */
export type BullBoardMountReason = 'mounted' | 'disabled_in_production' | 'worker_role'

export interface BullBoardMount {
  readonly mounted: boolean
  readonly reason: BullBoardMountReason
}

export function resolveBullBoardMount(
  env: Readonly<Record<string, string | undefined>>
): BullBoardMount {
  if (env.PROCESS_ROLE === 'worker') return { mounted: false, reason: 'worker_role' }
  return isBullBoardEnabled(env.NODE_ENV, env.ENABLE_BULL_BOARD, env.PROCESS_ROLE)
    ? { mounted: true, reason: 'mounted' }
    : { mounted: false, reason: 'disabled_in_production' }
}

/**
 * The ONE decision about mounting the Board, taken once when this module is first imported — the
 * same moment, and from the same raw `process.env`, as the module graph that mounts (or omits) the
 * router: before `ConfigModule` loads `.env`. The module graph, the Console summary (`board.state`),
 * the OpenAPI document and the tests all read this object, so what is reported can never disagree
 * with what is mounted (a flag that only a later `.env` load supplies mounts nothing and reports
 * nothing). A leaf module on purpose: no Nest, no queue, no import cycle.
 */
export const BULL_BOARD_MOUNT: BullBoardMount = Object.freeze(resolveBullBoardMount(process.env))
