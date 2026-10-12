import {
  inviteListQuerySchema,
  inviteRoleChoicesQuerySchema,
  inviteRoleChoicesResponseSchema,
  managerInviteOperationResponseSchema,
  reissueInviteSchema,
  revokeInviteQuerySchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../../common/schemas/schema-dto'

export class InviteListQueryDto extends createSchemaDto(inviteListQuerySchema) {}
export class InviteRoleChoicesQueryDto extends createSchemaDto(inviteRoleChoicesQuerySchema) {}
export class InviteRoleChoicesResponseDto extends createSchemaDto(
  inviteRoleChoicesResponseSchema
) {}
export const ReissueInviteDto = createSchemaDto(reissueInviteSchema)
export class RevokeInviteQueryDto extends createSchemaDto(revokeInviteQuerySchema) {}
export const ManagerInviteOperationResponseDto = createSchemaDto(
  managerInviteOperationResponseSchema
)
