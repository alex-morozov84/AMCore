import { createZodDto } from 'nestjs-zod'

import { updateUserSystemRoleSchema } from '@amcore/shared'

export class UpdateSystemRoleDto extends createZodDto(updateUserSystemRoleSchema) {}
