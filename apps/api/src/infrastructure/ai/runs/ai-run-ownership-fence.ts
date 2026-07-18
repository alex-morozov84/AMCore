import { AiConversationControl, AiConversationState, Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/prisma'

/**
 * Conversation ownership fence (Track C — ADR-054 / ADR-049, Arc F, worker role). A run freezes its
 * owning conversation's `ownershipGeneration` at creation (`ClaimedRun.ownershipGeneration`). A human
 * takeover increments that generation (and flips control to `HUMAN`/`PAUSED_FOR_HUMAN`), so any run
 * bound to an older generation must NEVER write into the conversation again. This is the
 * generation-fence pattern from ADR-049 (avatar mutation), applied to the AI transcript: the lease
 * token proves *worker* ownership, but only a resource-visible generation can fence a *human* takeover.
 *
 * Two entry points: a non-locking `readBotOwnership` for the pre-provider-call early exits (preflight
 * + loop-top), and a `lockAndAssertBotOwnership` that locks the conversation row `FOR UPDATE` inside a
 * durable-write transaction and throws `ConversationSupersededError` if it moved — so the whole write
 * (assistant turn / refusal / approval park) rolls back atomically and the caller terminalizes the run.
 */

/** Thrown inside a durable-write tx when the conversation moved past the run's generation snapshot. */
export class ConversationSupersededError extends Error {
  constructor() {
    super('Conversation ownership moved past the run generation snapshot')
    this.name = 'ConversationSupersededError'
  }
}

/** The three fence columns, as strings (both the raw `::text` and the Prisma enum resolve to these). */
export interface OwnershipFenceRow {
  ownershipGeneration: number
  controlledBy: string
  state: string
}

/**
 * True when a run frozen at `runGeneration` may NO LONGER write into the conversation: the generation
 * advanced, a human holds control, or it is no longer `ACTIVE`. A missing row also counts as stale.
 */
export function isBotOwnershipStale(
  row: OwnershipFenceRow | null | undefined,
  runGeneration: number
): boolean {
  if (!row) return true
  return (
    row.ownershipGeneration !== runGeneration ||
    row.controlledBy !== AiConversationControl.BOT ||
    row.state !== AiConversationState.ACTIVE
  )
}

/** Non-locking read of the fence columns (preflight + loop-top early exits). `null` if the row is gone. */
export async function readBotOwnership(
  prisma: PrismaService,
  conversationId: string
): Promise<OwnershipFenceRow | null> {
  const row = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    select: { ownershipGeneration: true, controlledBy: true, state: true },
  })
  return row
}

/**
 * Lock the conversation row `FOR UPDATE` inside a durable-write tx and assert the run may still write.
 * Throws `ConversationSupersededError` (rolling the tx back) if the generation/control/state moved.
 * The lock also serializes the transcript append against concurrent writers (it replaces the plain
 * `SELECT id … FOR UPDATE` the finalizers used before the fence existed).
 */
export async function lockAndAssertBotOwnership(
  tx: Prisma.TransactionClient,
  conversationId: string,
  runGeneration: number
): Promise<void> {
  const rows = await tx.$queryRaw<OwnershipFenceRow[]>(Prisma.sql`
    SELECT "ownershipGeneration",
           "controlledBy"::text AS "controlledBy",
           state::text AS state
    FROM "ai"."ai_conversations"
    WHERE id = ${conversationId}
    FOR UPDATE
  `)
  if (isBotOwnershipStale(rows[0] ?? null, runGeneration)) {
    throw new ConversationSupersededError()
  }
}
