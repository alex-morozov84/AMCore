import { Module } from '@nestjs/common'

import { BullBoardAuthService } from './bull-board-auth.service'

/**
 * Provides the read-only Bull Board access verifier to the dynamically
 * created Bull Board module via `BullBoardModule.forRootAsync({ imports })`.
 *
 * Deliberately depends on nothing but the global `PrismaService` — importing
 * `AuthModule` here would close a `QueueModule → AuthModule → EmailModule →
 * QueueModule` cycle.
 */
@Module({
  providers: [BullBoardAuthService],
  exports: [BullBoardAuthService],
})
export class BullBoardAuthModule {}
