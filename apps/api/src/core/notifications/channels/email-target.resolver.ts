import { NotificationChannel } from '../notification.constants'
import { NotificationTerminalReason } from '../notification-dispatch.constants'

import type {
  ChannelTargetResolver,
  ResolvedDeliveryTarget,
  TargetResolutionContext,
} from './channel-target-resolver.types'

import { redactEmail } from '@/common/utils'

/** Bounded terminal reason: the account email is not a usable notification target. */
export const EMAIL_SKIP_UNVERIFIED = NotificationTerminalReason.DESTINATION_UNVERIFIED

/**
 * Email target resolver (ADR-052 / Arc B). One target per recipient — the account
 * email. Notification email requires a **verified** destination (owner decision
 * 2026-06-18): an unverified address yields a `SKIPPED` delivery
 * (`destination_unverified`), never `PENDING`, so the dispatcher does not retry an
 * identity absence. The mandatory in-app channel still guarantees the user sees the
 * event. A successful password reset promotes `emailVerified`, so the post-reset
 * `account.password_changed` email is always deliverable.
 */
export class EmailTargetResolver implements ChannelTargetResolver {
  readonly channel = NotificationChannel.EMAIL

  resolveTargets(context: TargetResolutionContext): ResolvedDeliveryTarget[] {
    const { email, emailCanonical, emailVerified } = context.recipient
    const target: ResolvedDeliveryTarget = {
      // emailCanonical is unique-per-user and stable — the adapter-owned identity.
      targetKey: emailCanonical,
      destinationSnapshot: { email: redactEmail(email) },
    }
    if (!emailVerified) target.skipReasonCode = EMAIL_SKIP_UNVERIFIED
    return [target]
  }
}
