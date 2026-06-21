import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import {
  DEFAULT_TELEGRAM_API_BASE_URL,
  TELEGRAM_MAX_RESPONSE_BYTES,
  TELEGRAM_REQUEST_TIMEOUT_MS,
  TelegramDeliveryError,
} from './telegram.constants'

import { EnvService } from '@/env/env.service'

/** One outbound text message. Plain text only — no `parse_mode` (no escaping/injection surface). */
export interface TelegramSendMessageInput {
  chatId: string
  text: string
}

/**
 * Bot API send outcome, mapped by the deliverer (D.5) to a durable `DeliveryResult`.
 * `retryAfterMs` is the provider flood-wait floor for a transient `rate_limited`.
 */
export type TelegramSendResult =
  | { status: 'delivered'; providerMessageId?: string }
  | { status: 'transient'; errorCode: string; retryAfterMs?: number }
  | { status: 'permanent'; errorCode: string }

/**
 * Bounded projection of a Bot API response: `result` is narrowed to only the shapes used here
 * (a message with `message_id`, or a boolean for `setWebhook`) — every other Message field is
 * stripped. Unknown top-level fields are stripped too (`.partial()` default strip).
 */
const botApiResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    result: z.union([z.boolean(), z.object({ message_id: z.number().int() }).partial()]).optional(),
    error_code: z.number().optional(),
    description: z.string().max(500).optional(),
    parameters: z
      .object({ retry_after: z.number().optional(), migrate_to_chat_id: z.number().optional() })
      .partial()
      .optional(),
  })
  .partial()

type BotApiResponse = z.infer<typeof botApiResponseSchema>
type BotApiCall = { httpStatus: number; body: BotApiResponse } | 'transport_error'

/**
 * Direct Telegram Bot API client (worker infra, Arc D / D.3). `fetch` + an abort timeout, a
 * **validated base-URL override** (`TELEGRAM_API_BASE_URL`, fake-server-testable), and the
 * `TELEGRAM_BOT_TOKEN`. The token sits in the request path, so the token-bearing URL **never**
 * appears in a thrown error or log — failures map to bounded codes only. No framework, no
 * `parse_mode`. Classification uses the **HTTP status** (Telegram sets it == `error_code`), so a
 * non-2xx body claiming `ok:true` is never counted as delivered.
 */
@Injectable()
export class TelegramBotApiClient {
  constructor(private readonly env: EnvService) {}

  async sendMessage(input: TelegramSendMessageInput): Promise<TelegramSendResult> {
    const outcome = await this.call('sendMessage', { chat_id: input.chatId, text: input.text })
    if (outcome === 'transport_error') {
      return { status: 'transient', errorCode: TelegramDeliveryError.PROVIDER_TRANSIENT }
    }
    return classifySend(outcome.httpStatus, outcome.body)
  }

  /**
   * Deploy-time `setWebhook` (used by the setup CLI). Returns whether Telegram accepted it (HTTP
   * 2xx + `ok:true`); never surfaces the token-bearing URL. `allowed_updates:['message']` narrows
   * the feed.
   */
  async setWebhook(url: string, secret: string, dropPending = false): Promise<boolean> {
    const outcome = await this.call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: dropPending,
    })
    return outcome !== 'transport_error' && isHttpOk(outcome.httpStatus) && outcome.body.ok === true
  }

  /**
   * One bounded request. Returns the HTTP status + parsed projection, or `'transport_error'` for
   * network/timeout/oversize. A received-but-unparseable body keeps the status (so e.g. a degraded
   * 429 still classifies as rate-limited) with an empty projection.
   */
  private async call(method: string, payload: object): Promise<BotApiCall> {
    const token = this.env.get('TELEGRAM_BOT_TOKEN')
    const baseUrl = (
      this.env.get('TELEGRAM_API_BASE_URL') ?? DEFAULT_TELEGRAM_API_BASE_URL
    ).replace(/\/+$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`${baseUrl}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const text = await readBounded(response)
      if (text === undefined) return 'transport_error'
      return { httpStatus: response.status, body: parseBody(text) }
    } catch {
      // Never leak the token-bearing URL or the raw error.
      return 'transport_error'
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Read the body with a true **byte** ceiling. Rejects an honest oversize `content-length` before
 * reading, then streams `response.body` counting `Uint8Array.byteLength` per chunk and **cancels
 * early** the moment the cumulative bytes exceed the ceiling — so a chunked, compressed (fetch
 * decompresses), or multibyte body cannot bypass it (UTF-16 `String.length` would). Returns the
 * decoded text, or `undefined` (→ transient) on oversize/stream error.
 */
async function readBounded(response: Response): Promise<string | undefined> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > TELEGRAM_MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    return undefined
  }
  if (!response.body) {
    const text = await response.text()
    return Buffer.byteLength(text, 'utf8') > TELEGRAM_MAX_RESPONSE_BYTES ? undefined : text
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || value === undefined) break
      total += value.byteLength
      if (total > TELEGRAM_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        return undefined
      }
      chunks.push(value)
    }
  } catch {
    return undefined
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Parse + bounded-project the body; an unparseable/unexpected body yields an empty projection. */
function parseBody(text: string): BotApiResponse {
  try {
    const parsed = botApiResponseSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

function isHttpOk(status: number): boolean {
  return status >= 200 && status < 300
}

/**
 * Map an HTTP status + parsed body to a send outcome. 2xx + `ok:true` → delivered. Destination
 * errors are permanent and fence the connection (403 blocked; 400 chat-not-found; 400 +
 * `migrate_to_chat_id`, value never logged). 429 / 408 / 5xx / network are transient. Any other
 * deterministic 4xx (bad token/method/request) → `telegram_provider_permanent` (permanent, but it
 * does NOT fence the destination — D.5).
 */
function classifySend(httpStatus: number, body: BotApiResponse): TelegramSendResult {
  if (isHttpOk(httpStatus) && body.ok === true) {
    return { status: 'delivered', providerMessageId: extractMessageId(body.result) }
  }
  if (httpStatus === 429) {
    return {
      status: 'transient',
      errorCode: TelegramDeliveryError.RATE_LIMITED,
      retryAfterMs: toRetryAfterMs(body.parameters?.retry_after),
    }
  }
  if (httpStatus === 403) return { status: 'permanent', errorCode: TelegramDeliveryError.BLOCKED }
  if (httpStatus === 400 && body.parameters?.migrate_to_chat_id !== undefined) {
    return { status: 'permanent', errorCode: TelegramDeliveryError.MIGRATED }
  }
  if (httpStatus === 400 && /chat not found/i.test(body.description ?? '')) {
    return { status: 'permanent', errorCode: TelegramDeliveryError.CHAT_NOT_FOUND }
  }
  if (httpStatus === 408 || httpStatus >= 500) {
    return { status: 'transient', errorCode: TelegramDeliveryError.PROVIDER_TRANSIENT }
  }
  if (httpStatus >= 400) {
    return { status: 'permanent', errorCode: TelegramDeliveryError.PROVIDER_PERMANENT }
  }
  // A 2xx with ok:false (or other anomaly) — retry rather than permanently fail.
  return { status: 'transient', errorCode: TelegramDeliveryError.PROVIDER_TRANSIENT }
}

/** Defensively read `result.message_id` (sendMessage) — absent for a boolean/other result. */
function extractMessageId(result: BotApiResponse['result']): string | undefined {
  if (typeof result === 'object' && result !== null && typeof result.message_id === 'number') {
    return result.message_id.toString()
  }
  return undefined
}

/** Validate a finite positive **safe** integer seconds floor → ms; ignore anything else. */
function toRetryAfterMs(retryAfter: number | undefined): number | undefined {
  if (retryAfter === undefined || !Number.isSafeInteger(retryAfter) || retryAfter <= 0) {
    return undefined
  }
  return retryAfter * 1000
}
