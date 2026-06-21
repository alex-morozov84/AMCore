import { z } from 'zod'

/**
 * Telegram linking API contracts (Track B — Arc D, additive over ADR-052).
 *
 * Language-agnostic, no human-readable messages. The bearer surface is:
 *   - `POST   /notifications/telegram/link`       → one-time deep-link URL + expiry
 *   - `GET    /notifications/telegram/connection`  → current connection status
 *   - `DELETE /notifications/telegram/connection`  → unlink (204, no body)
 *
 * The **raw** link token is returned only inside the one-time `url`; it is never stored
 * (only its sha256 is at rest) and never echoed back by the status endpoint.
 */

/**
 * Wire connection status — the lowercase projection of `TelegramConnectionStatus`.
 * `blocked` means a permanent destination error fenced the connection; the user must
 * relink. Kept as a bounded enum (the lifecycle is closed, unlike open channel strings).
 */
export const telegramConnectionStatusSchema = z.enum(['active', 'blocked'])

export type TelegramConnectionStatusValue = z.infer<typeof telegramConnectionStatusSchema>

/**
 * Response to `POST /notifications/telegram/link`. `url` is the `https://t.me/<bot>?start=…`
 * deep link carrying the one-time token; `expiresAt` is when that token stops binding.
 */
export const telegramLinkResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
})

export type TelegramLinkResponse = z.infer<typeof telegramLinkResponseSchema>

/**
 * Response to `GET /notifications/telegram/connection`. The **canonical** contract is a
 * discriminated union on `connected` so a contradictory state is unrepresentable in BOTH the
 * runtime validation and the generated TypeScript type: disconnected = `false + null + null`
 * (stable keys for clients), connected = `true + status + linkedAt`. Carries no chat/user id.
 *
 * Note: `createZodDto`/OpenAPI cannot consume a `discriminatedUnion` directly, so the API ships a
 * narrow flat DTO adapter for the document only (`apps/api/.../telegram.dto.ts`), with a
 * compile-time assertion that this union stays assignable to it — the shared contract is NOT
 * weakened to fit the DTO library. Language-agnostic: no human-readable messages here.
 */
export const telegramConnectionResponseSchema = z.discriminatedUnion('connected', [
  z.object({
    connected: z.literal(false),
    status: z.null(),
    linkedAt: z.null(),
  }),
  z.object({
    connected: z.literal(true),
    status: telegramConnectionStatusSchema,
    linkedAt: z.iso.datetime(),
  }),
])

export type TelegramConnectionResponse = z.infer<typeof telegramConnectionResponseSchema>
