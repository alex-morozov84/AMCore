import { createZodDto } from 'nestjs-zod'

import { updateRoleSchema } from '@amcore/shared'

export class UpdateRoleDto extends createZodDto(updateRoleSchema) {}
