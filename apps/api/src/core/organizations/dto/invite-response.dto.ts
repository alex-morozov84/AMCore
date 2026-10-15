import {
  acceptInviteResponseSchema,
  inviteListResponseSchema,
  inviteResponseSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto.js'

/**
 * Response DTOs for the pending-invite surface (OB-02).
 *
 * Used with `@SchemaResponse` so any field outside the canonical
 * shape declared in `packages/shared/src/schemas/invite.ts` is stripped
 * at the transport layer. The uniform `{ status: 'invited' }` shape is
 * the non-enumeration contract — see `createInviteSchema` JSDoc.
 */
export class InviteResponseDto extends createSchemaDto(inviteResponseSchema) {}

export class InviteListResponseDto extends createSchemaDto(inviteListResponseSchema) {}

export const AcceptInviteResponseDto = createSchemaDto(
  acceptInviteResponseSchema,
  'AcceptInviteResponseDto'
)
