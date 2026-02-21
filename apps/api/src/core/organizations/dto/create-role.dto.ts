import { createZodDto } from 'nestjs-zod'

import { createRoleSchema } from '@amcore/shared'

export class CreateRoleDto extends createZodDto(createRoleSchema) {}
