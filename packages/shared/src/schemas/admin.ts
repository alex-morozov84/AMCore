import { z } from 'zod'

import { SystemRole } from '../enums'

/** Update user system role (SUPER_ADMIN only) */
export const updateUserSystemRoleSchema = z.object({
  systemRole: z.enum([SystemRole.User, SystemRole.SuperAdmin]),
})

export type UpdateUserSystemRoleInput = z.infer<typeof updateUserSystemRoleSchema>
