import { Injectable } from '@nestjs/common'

import type {
  WebhookVerificationInput,
  WebhookVerificationResult,
  WebhookVerifier,
} from './webhook.types'
import { constantTimeEquals } from './webhook-crypto'

/**
 * The header Telegram attaches to every webhook POST when `setWebhook(secret_token=…)`
 * was configured (Bot API). Node lowercases incoming header keys.
 */
export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token'

/**
 * Secret-header webhook verifier (ADR-044 family extension — Arc D). Unlike the HMAC
 * verifiers, Telegram provides **no body signature and no timestamp**: it sends a static
 * shared secret in a header, which we compare to the configured secret in constant time.
 *
 * Replay safety is NOT this verifier's job — Telegram retries until 2xx, so the product handler
 * owns a **durable** DB `update_id` dedupe (D.6) — the DB receipt carries the chosen retention
 * window, not the id itself — and the provider's `replayId` returns `undefined` (the TTL-bounded
 * Redis layer is a no-op for Telegram, since a retry can outlive any Redis TTL).
 */
@Injectable()
export class TelegramSecretTokenVerifier implements WebhookVerifier<void> {
  verify(input: WebhookVerificationInput): WebhookVerificationResult {
    const header = input.headers[TELEGRAM_SECRET_HEADER]
    // Only a single string header is valid; missing/array/non-string → invalid (uniform
    // 401, never a distinct signal that the header was absent vs wrong).
    const value = typeof header === 'string' ? header : undefined
    if (value === undefined || !constantTimeEquals(value, input.secret)) {
      return { ok: false, reason: 'WEBHOOK_SIGNATURE_INVALID' }
    }
    return { ok: true }
  }
}
