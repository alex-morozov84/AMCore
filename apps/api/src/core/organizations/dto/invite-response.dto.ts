import { createZodDto } from 'nestjs-zod'

import {
  acceptInviteResponseSchema,
  inviteListResponseSchema,
  inviteResponseSchema,
} from '@amcore/shared'

/**
 * Response DTOs for the pending-invite surface (OB-02).
 *
 * Used with `@ZodSerializerDto` so any field outside the canonical
 * shape declared in `packages/shared/src/schemas/invite.ts` is stripped
 * at the transport layer. The uniform `{ status: 'invited' }` shape is
 * the non-enumeration contract — see `createInviteSchema` JSDoc.
 */
export class InviteResponseDto extends createZodDto(inviteResponseSchema) {}

export class InviteListResponseDto extends createZodDto(inviteListResponseSchema) {}

export class AcceptInviteResponseDto extends createZodDto(acceptInviteResponseSchema) {}
