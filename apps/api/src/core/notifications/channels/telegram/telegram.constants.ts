/**
 * Bounded Telegram-channel vocabulary (Track B — Arc D, additive over ADR-052).
 *
 * Channel-specific terminal/cancel/attempt codes live with the adapter (mirroring the
 * email deliverer's local error const), not in the generic dispatch constants. Every
 * value is a machine-readable bounded string — never a provider body, chat/user id, or
 * token. The generic codes (`attempts_exhausted`, …) still apply from
 * `notification-dispatch.constants.ts`.
 */

/**
 * Terminal `SKIPPED` reasons emitted by the **core** target resolver when a destination
 * is absent or unusable (never retried). Distinct codes so the two states are observable
 * apart: no connection at all vs. a connection fenced off by a permanent error.
 */
export const TelegramTerminalReason = {
  /** No `TelegramConnection` for the recipient. */
  NOT_LINKED: 'telegram_not_linked',
  /** A connection exists but is `BLOCKED` (permanent destination error fenced it). */
  DESTINATION_UNAVAILABLE: 'telegram_destination_unavailable',
} as const

/**
 * Bounded `CANCELLED` reasons applied to a connection's still-due deliveries
 * (`PENDING`/`RETRY_SCHEDULED`) when its destination is torn down or fenced, so no
 * in-flight delivery survives to message a stale/relinked chat.
 */
export const TelegramCancelReason = {
  /** Relink: the owner's prior connection was replaced by a fresh `/start` bind. */
  CONNECTION_REPLACED: 'telegram_connection_replaced',
  /** Explicit unlink (`DELETE …/connection`). */
  CONNECTION_UNLINKED: 'telegram_connection_unlinked',
  /** Deliverer fenced the connection `BLOCKED` on a permanent destination error. */
  CONNECTION_BLOCKED: 'telegram_connection_blocked',
} as const

/**
 * Bot API request timeout (the client's own `AbortController`). Comfortably under the
 * dispatcher's `NOTIFICATION_PROVIDER_TIMEOUT_MS` (10s) so the client aborts first and
 * maps to a bounded transient code rather than the dispatcher's generic timeout.
 */
export const TELEGRAM_REQUEST_TIMEOUT_MS = 8000

/** Defensive ceiling on a Bot API response body (responses are normally < 4KB). */
export const TELEGRAM_MAX_RESPONSE_BYTES = 64 * 1024

/** Default public Bot API base URL (overridable for the fake-server e2e). */
export const DEFAULT_TELEGRAM_API_BASE_URL = 'https://api.telegram.org'

/** One-time deep-link token lifetime (mirrors the password-reset window). */
export const TELEGRAM_LINK_TOKEN_TTL_MS = 15 * 60 * 1000 // 15 min

/**
 * Deep-link token grammar: 32 random bytes as base64url = 43 chars (`A-Za-z0-9_-`), well
 * within Telegram's 64-char `start` parameter limit. The webhook `/start` projection matches
 * exactly this length/charset — no trailing content.
 */
export const TELEGRAM_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** Official `setWebhook(secret_token=…)` grammar (1–256 of `A-Za-z0-9_-`). */
export const TELEGRAM_WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/

/** Public bot-username grammar (5–32 of `A-Za-z0-9_`), used for the deep link + command. */
export const TELEGRAM_BOT_USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/

/**
 * Bounded attempt `errorCode`s from the Bot API send taxonomy (D.3/D.5). Destination
 * permanents (`telegram_blocked`/`telegram_chat_not_found`/`telegram_migrated`) fence the
 * connection in D.5; `telegram_provider_permanent` (deterministic config/request defects:
 * unknown 4xx, bad token, bad method) is permanent but does NOT fence the destination;
 * `telegram_rate_limited`/`telegram_provider_transient` retry. The `migrate_to_chat_id`
 * value is never logged — remap is an additive later concern.
 */
export const TelegramDeliveryError = {
  /** 403 — bot blocked / user deactivated. Permanent (fences the destination). */
  BLOCKED: 'telegram_blocked',
  /** 400 chat not found. Permanent (fences the destination). */
  CHAT_NOT_FOUND: 'telegram_chat_not_found',
  /** 400 + `migrate_to_chat_id`. Permanent, fences (value not logged). */
  MIGRATED: 'telegram_migrated',
  /** 429 + `retry_after`. Transient, honoring the provider floor. */
  RATE_LIMITED: 'telegram_rate_limited',
  /** Network / 5xx / 408 / timeout / oversize. Transient. */
  PROVIDER_TRANSIENT: 'telegram_provider_transient',
  /** Deterministic unknown 4xx (bad token/method/request). Permanent, does NOT fence. */
  PROVIDER_PERMANENT: 'telegram_provider_permanent',
  /** The definition forbids Telegram exposure. Permanent, does NOT fence (our config). */
  CONTENT_FORBIDDEN: 'telegram_content_forbidden',
  /** The stored payload failed its schema at render time. Permanent, does NOT fence. */
  PAYLOAD_INVALID: 'telegram_payload_invalid',
} as const

/**
 * The permanent send codes that fence the **destination** (block the connection + cancel its
 * other due deliveries in D.5). A non-destination permanent (`telegram_provider_permanent`,
 * content/payload codes) must NOT disable a user's connection.
 */
export const TELEGRAM_FENCING_ERROR_CODES: ReadonlySet<string> = new Set([
  TelegramDeliveryError.BLOCKED,
  TelegramDeliveryError.CHAT_NOT_FOUND,
  TelegramDeliveryError.MIGRATED,
])
