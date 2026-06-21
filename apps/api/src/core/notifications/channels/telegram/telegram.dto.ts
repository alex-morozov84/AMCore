import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

import {
  type TelegramConnectionResponse,
  telegramConnectionStatusSchema,
  telegramLinkResponseSchema,
} from '@amcore/shared'

/** `POST /notifications/telegram/link` → one-time deep-link URL + expiry. */
export class TelegramLinkResponseDto extends createZodDto(telegramLinkResponseSchema) {}

/**
 * OpenAPI/`@ZodResponse` adapter ONLY. The canonical contract is the shared
 * `telegramConnectionResponseSchema` discriminated union, but `createZodDto`/OpenAPI cannot consume
 * a `discriminatedUnion` (it is not a single object type). This flat refined object documents the
 * same shape and still rejects contradictory states at validation time; it is never the source of
 * truth. Language-agnostic (no `.refine` message). The controller returns the shared **union** type
 * — the assertion below fails to compile if that union ever stops being a subtype of this shape.
 */
const flatConnectionResponseSchema = z
  .object({
    connected: z.boolean(),
    status: telegramConnectionStatusSchema.nullable(),
    linkedAt: z.iso.datetime().nullable(),
  })
  .refine((value) =>
    value.connected
      ? value.status !== null && value.linkedAt !== null
      : value.status === null && value.linkedAt === null
  )

export class TelegramConnectionResponseDto extends createZodDto(flatConnectionResponseSchema) {}

// Compile-time contract guard: the canonical shared union must remain assignable to the flat
// adapter (so the controller can return the union while `@ZodResponse` documents the flat shape).
// A drift between the two stops compiling here.
type _AssertUnionMatchesAdapter =
  TelegramConnectionResponse extends z.infer<typeof flatConnectionResponseSchema> ? true : never
const _assertUnionMatchesAdapter: _AssertUnionMatchesAdapter = true
void _assertUnionMatchesAdapter
