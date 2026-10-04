import { Injectable, type OnModuleInit } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

/**
 * `BULL_BOARD_READ_ONLY` is retired: the queue board has no writable mode, so the variable does
 * nothing, whatever its value. A deployment that still sets it gets one warning per start (roles
 * `all` and `web`; the worker never serves the board) instead of a failed boot: the flag only ever
 * widened access, so ignoring it is the safe direction. Read at `onModuleInit`, after `.env` has been
 * loaded, so a value that only the file supplies is noticed too.
 */
export function hasRetiredReadOnlyFlag(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.PROCESS_ROLE !== 'worker' && env.BULL_BOARD_READ_ONLY !== undefined
}

@Injectable()
export class BullBoardLegacyFlagWarning implements OnModuleInit {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(BullBoardLegacyFlagWarning.name)
  }

  onModuleInit(): void {
    if (!hasRetiredReadOnlyFlag(process.env)) return
    this.logger.warn(
      { event: 'bull_board.legacy_read_only_flag_ignored' },
      'BULL_BOARD_READ_ONLY is ignored: the queue board is always read-only. Remove the variable.'
    )
  }
}
