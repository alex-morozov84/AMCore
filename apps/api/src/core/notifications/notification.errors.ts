/**
 * Domain errors for the notification definition layer. The HTTP/service layer maps
 * these to the appropriate response; the registry itself stays transport-agnostic.
 */

/** Thrown when a producer references a notification type with no registered definition. */
export class UnknownNotificationTypeError extends Error {
  constructor(readonly type: string) {
    super(`Unknown notification type: ${type}`)
    this.name = 'UnknownNotificationTypeError'
  }
}

/** Thrown at bootstrap when two definitions claim the same type. */
export class DuplicateNotificationDefinitionError extends Error {
  constructor(readonly type: string) {
    super(`Duplicate notification definition: ${type}`)
    this.name = 'DuplicateNotificationDefinitionError'
  }
}

/** Thrown at bootstrap when a definition violates a structural invariant. */
export class InvalidNotificationDefinitionError extends Error {
  constructor(
    readonly type: string,
    readonly reason: string
  ) {
    super(`Invalid notification definition "${type}": ${reason}`)
    this.name = 'InvalidNotificationDefinitionError'
  }
}

/**
 * Thrown when an idempotency key is reused for a notification with a different
 * fingerprint (same `(recipientUserId, idempotencyKey)`, different content) — a
 * caller bug, not a safe replay.
 */
export class NotificationIdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Notification idempotency key reused with a different payload: ${idempotencyKey}`)
    this.name = 'NotificationIdempotencyConflictError'
  }
}
