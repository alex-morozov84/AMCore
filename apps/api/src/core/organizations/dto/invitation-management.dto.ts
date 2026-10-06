import { createZodDto } from 'nestjs-zod'

import {
  inviteListQuerySchema,
  inviteRoleChoicesQuerySchema,
  inviteRoleChoicesResponseSchema,
  managerInviteOperationResponseSchema,
  reissueInviteSchema,
  revokeInviteQuerySchema,
} from '@amcore/shared'

export class InviteListQueryDto extends createZodDto(inviteListQuerySchema) {}
export class InviteRoleChoicesQueryDto extends createZodDto(inviteRoleChoicesQuerySchema) {}
export class InviteRoleChoicesResponseDto extends createZodDto(inviteRoleChoicesResponseSchema) {}
export const ReissueInviteDto = createZodDto(reissueInviteSchema)
export class RevokeInviteQueryDto extends createZodDto(revokeInviteQuerySchema) {}
export const ManagerInviteOperationResponseDto = createZodDto(managerInviteOperationResponseSchema)
