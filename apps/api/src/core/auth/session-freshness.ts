import { HttpStatus } from '@nestjs/common'

import { AuthErrorCode, type RequestPrincipal } from '@amcore/shared'

import { AppException } from '@/common/exceptions'
import { PrismaService } from '@/prisma'

/** The 403 STEP_UP_REQUIRED an unfresh privileged action raises (client → `POST /auth/step-up`). */
function stepUpRequired(): AppException {
  return new AppException(
    'Step-up authentication required',
    HttpStatus.FORBIDDEN,
    AuthErrorCode.STEP_UP_REQUIRED
  )
}

/**
 * Assert the caller's session was (re)authenticated within `windowSec` (ADR-037 step-up). This is the
 * **single source** of the freshness rule, shared by `FreshAuthGuard` (static `@RequireFreshAuth`
 * routes) and the imperative **cross-user** checks (Arc F operator actions, where step-up is required
 * only when a SUPER_ADMIN acts on a conversation they do not own). Fail-closed everywhere with 403
 * `STEP_UP_REQUIRED`: missing sid/principal (legacy token), missing/revoked/expired session, owner
 * mismatch, or NULL/stale `lastAuthAt`. The session is read ONLY when invoked, so ordinary traffic
 * pays nothing; 403 (not 401) so a generic 401→refresh client can't loop — it branches on the code.
 */
export async function assertSessionFresh(
  prisma: PrismaService,
  windowSec: number,
  principal: RequestPrincipal | undefined
): Promise<void> {
  const sid = principal?.sid
  if (!sid || !principal) throw stepUpRequired()

  const session = await prisma.session.findUnique({
    where: { id: sid },
    select: { lastAuthAt: true, revokedAt: true, expiresAt: true, userId: true },
  })

  const now = Date.now()
  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() <= now ||
    session.userId !== principal.sub ||
    session.lastAuthAt === null ||
    now - session.lastAuthAt.getTime() > windowSec * 1000
  ) {
    throw stepUpRequired()
  }
}
